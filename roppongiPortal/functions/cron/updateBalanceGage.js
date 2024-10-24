
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
// 固定費マスタのID
const fixedCostDBId = defineString("FIXED_COST_DB_ID");
// 収支DBのID
const balanceDBId = defineString("BALANCE_DB_ID");

// 家計簿トップページ
const householdTopId = defineString("HOUSEHOLD_TOP_ID");


// 固定費マスタを収支DBにコピーする関数
exports.updateBalanceGage =
  onSchedule({
    timeZone: "Asia/Tokyo",
    schedule: "0 0 * * *", // 毎日0時に実行
  }, async (context) => {
    try {
    // Notionクライアントの初期化
      const notion = new Client({auth: notionApiKey.value()});
      // Notionからデータベースの情報を取得

      const now = dayjs.tz().add(1, "month");
      const thisYear = now.format("YYYY年");
      const thisMonth = now.format("M月");
      // const thisMonth = "9月";

      // const pageId = householdTopId.value();
      const blockId = "12934c95-cc30-80a0-a4cd-c9934f6913b3";
      const response = await notion.blocks.update({
        block_id: blockId,
        heading_1: {
          rich_text: [
            {
              text: {
                content: "   [||||||||||]",
              },
              annotations: {
                color: "green",
              },
            },
            {
              text: {
                content: " 100%",
              },
            },
          ],
        },
      });
    } catch (error) {
      console.error("Error updating Notion databases:", error);
      throw new functions.https
          .HttpsError("internal", "Notion API call failed");
    }
  });


