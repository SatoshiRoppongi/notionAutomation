const {onSchedule} = require("firebase-functions/v2/scheduler");
const {Client} = require("@notionhq/client");
const {defineString} = require("firebase-functions/params");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const customParseFormat = require("dayjs/plugin/customParseFormat");

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault("Asia/Tokyo");

// const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";
// エミュレーターかどうかを判定

/*
const storage = isEmulator ?
    new Storage({apiEndpoint: "http://localhost:9199"}) :
    new Storage(); // 本番環境
    */
const notionApiKey = defineString("NOTION_API_KEY");
const balanceDBId = defineString("BALANCE_DB_ID");
const summaryDBId = defineString("SUMMARY_DB_ID");


// 月別・カテゴリ別集計を行い、MonthlySummaryDB, CategorySummaryDBに反映させる
exports.makeSummary = onSchedule({
  timeZone: "Asia/Tokyo",
  schedule: "0 1 1 * *", // 毎月1日 1:00に実行
}, async (context) => {
  const targetDate = dayjs.tz().subtract(1, "month");

  // Notionクライアントの初期化
  const notion = new Client({auth: notionApiKey.value()});

  // 先々月、前年同月の年月テキスト
  const previousMonthText = targetDate.subtract(1, "month").format("YYYY年MM月");
  const lastYearSameMonthText = targetDate.
      subtract(1, "year").format("YYYY年MM月");

  // 先々月と前年同月のデータを取得する
  const previousMonthData = await queryNotionDBForPeriod(
      notion,
      previousMonthText,
      summaryDBId.value());
  const lastYearSameMonthData = await queryNotionDBForPeriod(
      notion,
      lastYearSameMonthText,
      summaryDBId.value());

  // 必要に応じてデータを処理し、集計項目に基づいて収支を取り出す
  const previousMonthSummary = {};
  const lastYearSameMonthSummary = {};

  previousMonthData.forEach((record) => {
    const category = record.properties["集計項目"].select.name;
    previousMonthSummary[category] = record.properties["収支"].number;
  });

  lastYearSameMonthData.forEach((record) => {
    const category = record.properties["集計項目"].select.name;
    lastYearSameMonthSummary[category] = record.properties["収支"].number;
  });

  // Notionからデータベースから情報を取得して収支サマリーを生成する前月分
  const allInfo = await makeReport(notion, targetDate);

  const insertSummaryObj = allInfo.categorySumsObj;
  insertSummaryObj["収入"] = allInfo.summaryInfo.income;
  insertSummaryObj["固定費"] = allInfo.summaryInfo.fixedCost;
  insertSummaryObj["変動費"] = allInfo.summaryInfo.variableCost;
  insertSummaryObj["支出"] = insertSummaryObj["固定費"] + insertSummaryObj["変動費"];

  const processedDataList = Object.keys(insertSummaryObj).map((item) => {
    return {
      properties: {
        "年月": {
          "title": [
            {
              "text": {
                "content": targetDate.format("YYYY年MM月"),
              },
            },
          ],
        },
        "集計項目": {
          "select": {
            name: item,
          },
        },
        "収支": {
          "number": insertSummaryObj[item],
        },
        "収支前月": {
          "number": previousMonthSummary[item] || 0, // 前月分の収支
        },
        "収支前年同月": {
          "number": lastYearSameMonthSummary[item] || 0, // 前年同月分の収支
        },
      },
    };
  });

  // データの挿入
  for (const processedData of processedDataList) {
    await notion.pages.create({
      parent: {database_id: summaryDBId.value()},
      properties: processedData.properties,
    });
  }

  return null;
});


/**
 * summaryDBから特定の期間のデータを取得する
 * @param {Client} notion notionクライアント
 * @param {string} period 年月 (テキスト形式: YYYY年MM月)
 * @param {string} summaryDBId summaryDBのID
 * @return {Promise<Array>} 取得したレコードの配列
 */
async function queryNotionDBForPeriod(notion, period, summaryDBId) {
  // summaryDBから特定の期間（年月テキスト）に一致するデータを取得する
  const queryResults = await notion.databases.query({
    database_id: summaryDBId,
    filter: {
      property: "年月",
      rich_text: {
        equals: period,
      },
    },
  });

  return queryResults.results;
}


/**
 *
 * @param {Client} notion notionクライアント
 * @param {dayjs.Dayjs} targetDate 対象年月日
 */
async function makeReport(notion, targetDate) {
  // 1日
  const startOfMonth = targetDate.startOf("month").format("YYYY-MM-DD");
  // 月末
  const endOfMonth = targetDate.endOf("month").format("YYYY-MM-DD");

  const retrieveResults = await notion.databases.retrieve({
    database_id: balanceDBId.value(),
  });

  // 定義されている分類の一覧を取得する
  const categories = retrieveResults.properties["分類"]
      .select
      .options;

  // カテゴリをキーとして、その合計金額をバリューとするオブジェクトを定義する
  // 金額は0で初期化する
  const categorySumsObj = {};
  for (const category of categories) {
    categorySumsObj[category ? category.name : "不明"] = 0;
  }

  const queryResults = await notion.databases.query({
    database_id: balanceDBId.value(),
    filter: {
      // todo: 適切なフィルタに修正する
      and: [
        {
          property: "実行年月日",
          date: {
            on_or_after: startOfMonth,
          },
        },
        {
          property: "実行年月日",
          date: {
            on_or_before: endOfMonth,
          },
        },
      ],
    },
    sorts: [
      {
        property: "実行年月日",
        direction: "ascending",
      },
    ],
  });

  const records = queryResults.results;


  // todo: 前月からの増加減少(%)もサマリー情報に含めたい
  const summaryInfo = {
    "income": 0,
    "fixedCost": 0,
    "variableCost": 0,
  };


  const detailReportHeaders =
    ["項目名", "収支", "決済方法", "実行年月日", "分類", "固定費", "出口・入口"];
  const detailReports = [];

  // レコードを精査して、各種情報を集計する
  for (const record of records) {
    const properties = record.properties;
    const amount = properties["収支"].formula.number;
    // 収入
    if (amount > 0 ) {
      summaryInfo.income += amount;
    // 支出
    } else {
      // 固定費集計
      if (properties["固定費"].checkbox) {
        summaryInfo.fixedCost += amount;
      // 変動費
      } else {
        summaryInfo.variableCost += amount;
      }
    }
    // カテゴリ別集計

    const category = properties["分類"].select;
    categorySumsObj[category ? category.name : "不明"] += amount;

    // レポートで出力する順番にカラムを並び替える
    // レポートで出力する形式に変換する
    const arrangedRecordList = detailReportHeaders.map(
        (propertyName) => {
          const property = properties[propertyName];
          let retValue;
          switch (property.type) {
            case "title":
              retValue = property.title[0] ?
                property.title[0].text.content : "不明";
              break;
            case "number":
              retValue = property.number;
              break;
            case "select":
              retValue = property.select ? property.select.name: "不明";
              break;
            case "formula":
              retValue = property.formula.type === "date" ?
                property.formula.date.start :
                property.formula[property.formula.type];
              break;
            case "checkbox":
              retValue = property.checkbox ? "はい" : "いいえ";
              break;
            default:
              retValue = "";
              break;
          }
          return retValue;
        },
    );
    detailReports.push(arrangedRecordList);
  }

  const allInfo = {
    detailReportsObj: {
      detailReportHeaders,
      detailReports,
    },
    summaryInfo,
    categorySumsObj,
  };


  return allInfo;
}

