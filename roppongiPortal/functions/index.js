const {onSchedule} = require("firebase-functions/v2/scheduler");
const {Client} = require("@notionhq/client");
const {defineString} = require("firebase-functions/params");
const functions = require("firebase-functions");

const notionApiKey = defineString("NOTION_API_KEY");
// 固定費マスタのID
const fixedCostDBId = defineString("FIXED_COST_DB_ID");
// 支出DBのID
const expenseDBId = defineString("EXPENSE_DB_ID");


exports.updateNotionDatabases =
onSchedule("every day 00:00", async (context) => {
  try {
    // Notionクライアントの初期化
    const notion = new Client({auth: notionApiKey.value()});
    // Notionからデータベースの情報を取得
    const response = await notion.databases.query({
      database_id: fixedCostDBId.value(),
    });


    // データを判定・加工
    const updatedData = processNotionData(response.results);

    // 別のデータベースにデータを書き込む
    for (const data of updatedData) {
      console.log(data);
      await notion.pages.create({
        parent: {database_id: expenseDBId.value()},
        properties: {
          // 必要なプロパティをここに記述
        },
      });
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

