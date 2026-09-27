const crypto = require("crypto");
const express = require("express");
const fetch = require("node-fetch");
const Order = require("../models/Order");
const PaymentOrder = require("../models/PaymentOrder");
const { buildCallbackSignString, buildPaymentSignString, md5GbkHex } = require("../utils/watchpay");

const router = express.Router();

function makeMerchantOrderNumber() {
  const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  return `EC${timestamp}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function formatOrderDate(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getGatewayConfig() {
  const { WATCHPAY_MERCHANT_ID, WATCHPAY_KEY, WATCHPAY_API_DOMAIN, WATCHPAY_NOTIFY_URL } = process.env;
  if (!WATCHPAY_MERCHANT_ID || !WATCHPAY_KEY || !WATCHPAY_API_DOMAIN || !WATCHPAY_NOTIFY_URL) {
    return null;
  }
  return {
    merchantId: WATCHPAY_MERCHANT_ID,
    key: WATCHPAY_KEY,
    apiDomain: WATCHPAY_API_DOMAIN.replace(/\/$/, ""),
    notifyUrl: WATCHPAY_NOTIFY_URL,
    payType: process.env.WATCHPAY_PAY_TYPE || "101",
    version: process.env.WATCHPAY_VERSION || "1.0",
  };
}

// Create an order + a WatchPay payment request, return the gateway checkout page
router.post("/watchpay/create", async (req, res) => {
  const gateway = getGatewayConfig();
  if (!gateway) return res.status(503).json({ message: "Payment gateway is not configured" });

  const { userSessionId, items, billing, subtotal, shipping, amount } = req.body;

  if (
    !userSessionId ||
    !Array.isArray(items) ||
    !items.length ||
    !billing ||
    !billing.firstName ||
    !billing.lastName ||
    !billing.email ||
    !billing.mobile ||
    !billing.address ||
    !billing.country ||
    !billing.state ||
    !billing.zip ||
    !amount
  ) {
    return res.status(400).json({ message: "Invalid order details" });
  }

  try {
    const order = await Order.create({
      userSessionId,
      items,
      billing,
      subtotal,
      shipping,
      amount,
      status: "pending",
    });

    const mchOrderNo = makeMerchantOrderNumber();
    const payment = await PaymentOrder.create({
      mchOrderNo,
      order: order._id,
      userSessionId,
      amount,
    });

    const params = {
      goods_name: "E-Commerce Order",
      mch_id: gateway.merchantId,
      mch_order_no: mchOrderNo,
      notify_url: gateway.notifyUrl,
      order_date: formatOrderDate(new Date()),
      pay_type: gateway.payType,
      trade_amount: String(amount),
      version: gateway.version,
    };
    const signature = md5GbkHex(buildPaymentSignString(params), gateway.key);
    const body = new URLSearchParams({ ...params, sign_type: "MD5", sign: signature }).toString();

    const response = await fetch(`${gateway.apiDomain}/pay/web`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Ecommerce/1.0" },
      body,
    });

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    payment.responseData = payload || { raw: text };
    await payment.save();

    if (!response.ok) return res.status(502).json({ message: "Payment gateway request failed" });

    res.status(201).json({
      orderId: payment._id,
      bookingId: order._id,
      payInfo: payload?.payInfo,
      html: payload ? null : text,
    });
  } catch (error) {
    res.status(500).json({ message: "Unable to start payment", error: error.message });
  }
});

// WatchPay server-to-server payment result callback
router.post("/watchpay/callback", express.urlencoded({ extended: true }), async (req, res) => {
  const gateway = getGatewayConfig();
  if (!gateway) return res.status(503).send("Payment gateway is not configured");

  const callback = req.body || {};
  const expectedSignature = md5GbkHex(buildCallbackSignString(callback), gateway.key);
  if ((callback.sign || "").toLowerCase() !== expectedSignature) return res.status(400).send("Signature error");

  try {
    const payment = await PaymentOrder.findOne({ mchOrderNo: callback.mchOrderNo || callback.mch_order_no });
    if (!payment) return res.status(404).send("Order not found");
    if (payment.status === "PAID") return res.send("success");

    const receivedAmount = Number(callback.oriAmount || callback.tradeAmount || callback.amount);
    if (String(callback.tradeResult) !== "1" || receivedAmount !== payment.amount) {
      payment.status = "FAILED";
      payment.responseData = callback;
      await payment.save();
      await Order.findByIdAndUpdate(payment.order, { status: "failed" });
      return res.send("success");
    }

    payment.status = "PAID";
    payment.gatewayOrderNo = callback.orderNo || null;
    payment.responseData = callback;
    await payment.save();
    await Order.findByIdAndUpdate(payment.order, { status: "confirmed" });

    res.send("success");
  } catch (error) {
    res.status(500).send("Server error");
  }
});

// Frontend polls this to know when the payment has completed
router.get("/watchpay/status/:orderId", async (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) return res.status(401).json({ message: "A checkout session is required" });

  const payment = await PaymentOrder.findOne({ _id: req.params.orderId, userSessionId: sessionId });
  if (!payment) return res.status(404).json({ message: "Order not found" });

  res.json({ status: payment.status, bookingId: payment.order });
});

module.exports = router;
