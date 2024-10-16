
const {setGlobalOptions} = require("firebase-functions/v2");

// 全てのfunctionsを東京リージョンにデプロイする
setGlobalOptions({
  region: "asia-northeast1",
});

const fixedCostsToBalanceDB = require("./cron/fixedCostsToBalanceDB");
const reportBalance = require("./cron/reportBalance");
const getLineGroupIds = require("./tools/getLineGroupIds");

exports.fixedCostsToBalanceDB = fixedCostsToBalanceDB.fixedCostsToBalanceDB;
exports.reportBalance = reportBalance.reportBalance;
exports.getLineGroupIds = getLineGroupIds.getLineGroupIds;
