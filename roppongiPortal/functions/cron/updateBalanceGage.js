
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {Client} = require("@notionhq/client");
const {defineString} = require("firebase-functions/params");
const functions = require("firebase-functions");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const customParseFormat = require("dayjs/plugin/customParseFormat");

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault("Asia/Tokyo");


const notionApiKey = defineString("NOTION_API_KEY");
// 収支DBのID
const balanceDBId = defineString("BALANCE_DB_ID");

// 家計簿トップページ
const householdTopId = defineString("HOUSEHOLD_TOP_ID");


// 固定費マスタを収支DBにコピーする関数
exports.updateBalanceGage =
  onSchedule({
    timeZone: "Asia/Tokyo",
    schedule: "0 2 * * *", // 毎日2時に実行
  }, async (context) => {
    // Notionクライアントの初期化
    const notion = new Client({auth: notionApiKey.value()});
    // Notionからデータベースの情報を取得
    const today = dayjs.tz();
    const thisMonth9th = today.date(9);

    // 基準月 今月10日を基準とする
    const baseMonthDate = today.isAfter(thisMonth9th, "day") ?
            today : today.subtract(1, "month");

    const startDate = baseMonthDate.date(10);
    const endDate = startDate.add(1, "month");

    const startDateUTC = startDate.utc().startOf("day").
        format("YYYY-MM-DDTHH:mm:ss[Z]");
    const endDateUTC = endDate.utc().startOf("day").
        format("YYYY-MM-DDTHH:mm:ss[Z]");


    const queryResults = await notion.databases.query({
      database_id: balanceDBId.value(),
      filter: {
        and: [
          {
            property: "実行年月日",
            date: {
              "on_or_after": startDateUTC,
            },
          },
          {
            property: "実行年月日",
            date: {
              "before": endDateUTC,
            },
          },
        ],
      },
    });

    const records = queryResults.results;

    let income = 0;
    let expense = 0;

    for (const record of records) {
      const properties = record.properties;
      if (properties["ステータス"].formula.string == "未実行") {
        // 未完了の処理`
      } else {
        // 本日実行 or 完了
        const amount = properties["収支"].formula.number;
        if (amount > 0) {
          income += amount;
        } else {
          expense += amount;
        }
      }
    }

    const batteryRemains = income > 0 ?
      Math.round((income + expense) * 100 / income) : 0;

    const remainPart = Math.round(batteryRemains / 10);
    const complementPart = 10 - remainPart;

    const batteryDisplay = "   [" +
      "|".repeat(remainPart) +
      " ".repeat(complementPart) +
      "]";

    const displayColor = batteryRemains >= 70 ? "green" :
      batteryRemains >= 30 ? "yellow" :
        "red";

    // const pageId = householdTopId.value();
    const blockId = "12934c95-cc30-80a0-a4cd-c9934f6913b3";
    await notion.blocks.update({
      block_id: blockId,
      heading_1: {
        rich_text: [
          {
            text: {
              content: batteryDisplay,
            },
            annotations: {
              color: displayColor,
            },
          },
          {
            text: {
              content: ` ${batteryRemains}%`,
            },
          },
        ],
      },
    });
  });


