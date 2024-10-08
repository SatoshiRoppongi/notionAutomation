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
const incomeExpenseDBId = defineString("IN_EX_DB_ID");


exports.updateNotionDatabases =
  onSchedule({
    timeZone: "Asia/Tokyo",
    schedule: "0 0 1 * *", // 毎月1日 0:00に実行
  }, async (context) => {
    try {
    // Notionクライアントの初期化
      const notion = new Client({auth: notionApiKey.value()});
      // Notionからデータベースの情報を取得

      const now = dayjs.tz();
      const thisYear = now.format("YYYY年");
      const thisMonth = now.format("M月");
      // const thisMonth = "12月";

      const response = await notion.databases.query({
        database_id: fixedCostDBId.value(),
        filter: {
          and: [
            {
              property: "終了",
              checkbox: {
                "equals": false,
              },
            },
            {
              or: [
                {
                  property: "実行月",
                  rich_text: {
                    contains: "毎月",
                  },
                },
                {
                  property: "実行月",
                  rich_text: {
                    contains: thisMonth,
                  },
                },
              ],
            },
          ],
        },
        sorts: [
          {
            property: "実行日",
            direction: "ascending",
          },
        ],
      });

      // todo: プロパティ名を変更してもソースコードを変えなくて良いように、プロパティ名を取得してそれをセットするようにする.
      const processedDataList = response.results.map((result) => {
        const jpDateString =
          thisYear + thisMonth +
          result.properties["実行日"].rich_text[0].text.content;

        console.log(jpDateString);
        const settlementDateString =
          dayjs(jpDateString, "YYYY年M月D日");// .format("YYYY-MM-DD");

        return {
          properties: {
            "項目名": {
              "title": [
                {
                  "text": {
                    "content": result.properties["項目名"].title[0].text.content,
                  },
                },
              ],
            },
            "収支": {
              "number": result.properties["収支"].number,
            },
            "固定費実行年月日": {
              "date": {
                start: settlementDateString,
              },
            },
            "分類": {
              "select": {
                name: result.properties["分類"].select.name,
              },
            },
            "固定費": {
              "checkbox": true,
            },
            "決済方法": {
              "select": {
                name: result.properties["決済方法"].select.name,
              },
            },
            "出口・入口": {
              "select": {
                name: result.properties["出口・入口"].select.name,
              },
            },
          },
        };
      });

      // データの挿入
      for (const processedData of processedDataList) {
        await notion.pages.create({
          parent: {database_id: incomeExpenseDBId.value()},
          properties: processedData.properties,
        });
      }


      // データを判定・加工
      const updatedData = processNotionData(response.results);

      // 別のデータベースにデータを書き込む
      for (const data of updatedData) {
      // console.log(data);
      /*
      await notion.pages.create({
        parent: {database_id: expenseDBId.value()},
        properties: {
          // 必要なプロパティをここに記述
        },
      });
      */
      }


      return null;
    } catch (error) {
      console.error("Error updating Notion databases:", error);
      throw new functions.https
          .HttpsError("internal", "Notion API call failed");
    }
  });

/**
* aaa
* @param {*} results
* @return {*}
*/
function processNotionData(results) {
  // データ判定・加工の処理を実装
  return results.map((result) => {
    // 加工処理
    return {
      // 加工されたデータを返す
    };
  });
}

