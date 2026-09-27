const crypto = require("crypto");
const iconv = require("iconv-lite");

function buildPaymentSignString(params) {
  const fields = [
    "bank_code",
    "goods_name",
    "mch_id",
    "mch_order_no",
    "mch_return_msg",
    "notify_url",
    "order_date",
    "page_url",
    "pay_type",
    "trade_amount",
    "version",
  ];

  return fields
    .filter((field) => params[field] !== undefined && params[field] !== "")
    .map((field) => `${field}=${params[field]}`)
    .join("&");
}

function buildCallbackSignString(params) {
  const fields = [
    "amount",
    "mchId",
    "mchOrderNo",
    "merRetMsg",
    "orderDate",
    "orderNo",
    "oriAmount",
    "tradeResult",
  ];

  return fields
    .filter((field) => params[field] !== undefined && params[field] !== null && params[field] !== "")
    .map((field) => `${field}=${params[field]}`)
    .join("&");
}

function md5GbkHex(value, key) {
  const signedValue = key ? `${value}&key=${key}` : value;
  return crypto
    .createHash("md5")
    .update(iconv.encode(signedValue, "gbk"))
    .digest("hex");
}

module.exports = { buildPaymentSignString, buildCallbackSignString, md5GbkHex };
