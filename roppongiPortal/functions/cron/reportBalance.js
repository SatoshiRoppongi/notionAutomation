const {onSchedule} = require("firebase-functions/v2/scheduler");
const {Client} = require("@notionhq/client");
const {defineString} = require("firebase-functions/params");
const {Storage} = require("@google-cloud/storage");
const axios = require("axios");
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
const storage = new Storage();
const bucketName = defineString("BUCKET_NAME");
const lineAccessToken = defineString("LINE_ACCESS_TOKEN");
const lineGroupId = defineString("LINE_GROUP_ID");
// const balanceDBId = defineString("BALANCE_DB_ID");
const summaryDBId = defineString("SUMMARY_DB_ID");

// 前月の収支をレポートする関数
exports.reportBalance =
    onSchedule({
      timeZone: "Asia/Tokyo",
      schedule: "0 8 1 * *", // 毎月1日 8:00に実行
    }, async (context) => {
      const targetDate = dayjs.tz().subtract(1, "month");

      // Notionクライアントの初期化
      const notion = new Client({auth: notionApiKey.value()});
      // Notionからデータベースから情報を取得して収支サマリーを生成する前月分
      const allInfo = await getReport(notion, targetDate);
      console.log(allInfo);

      // PDFファイル名
      const destination = `reports/report-${targetDate.format("YYYYMM")}.pdf`;

      // アップロードしたファイルの公開URLを取得
      const file = storage.bucket(bucketName.value()).file(destination);
      await file.makePublic();
      const publicUrl = file.publicUrl();

      // LINEグループにメッセージを送信
      await sendLineMessage(
          publicUrl,
          allInfo.summaryInfo,
          allInfo.categorySumsObj,
          targetDate);
    });


/**
 *
 * @param {Client} notion notionクライアント
 * @param {dayjs.Dayjs} targetDate 対象年月日
 */
async function getReport(notion, targetDate) {
  const targetDateFormatted = targetDate.format("YYYY年MM月");


  const queryResults = await notion.databases.query({
    database_id: summaryDBId.value(),
    filter: {
      property: "年月",
      rich_text: {
        contains: targetDateFormatted,
      },
    },
    sorts: [
      {
        property: "収支",
        direction: "ascending",
      },
    ],
  });

  const records = queryResults.results.map((rec) => rec.properties);

  const createSummary = () => ({
    number: 0, // 金額
    prevMonthRate: 0, // 前月比%
    lastYearSameMonthRate: 0, // 前年同月比%
  });

  const summaryInfo = {
    "支出": createSummary(),
    "収入": createSummary(),
    "固定費": createSummary(),
    "変動費": createSummary(),
  };

  // キー: 分類名, バリュー: 金額
  const categorySumsObj = {};
  for (const record of records) {
    const categoryName = record["集計項目"].select.name;
    const balance = record["収支"].number || 0;
    // 特別な集計項目
    if (["支出", "変動費", "固定費", "収入"].includes(categoryName)) {
      summaryInfo[categoryName].number = balance;
      summaryInfo[categoryName].prevMonthRate = record["前月比"].
          formula.number * 100;
      summaryInfo[categoryName].lastYearSameMonthRate = record["前年同期比"].
          formula.number * 100;
    } else {
      // カテゴリごとの集計
      categorySumsObj[categoryName] = balance;
    }
  }

  const allInfo = {
    summaryInfo,
    categorySumsObj,
  };
  return allInfo;
}

/**
 * LINEにメッセージを送信する関数
 * @param {string} pdfUrl 公開されたPDFのURL
 * @param {obj} summaryInfo 収支サマリー情報
 * @param {obj} categorySumsObj カテゴリ別合計
 * @param {dayjs.Dayjs} targetDate 対象年月日
 */
async function sendLineMessage(
    pdfUrl, summaryInfo, categorySumsObj, targetDate) {
  const lineApiUrl = "https://api.line.me/v2/bot/message/push";
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${lineAccessToken.value()}`,
  };

  const categoryForReport = Object.entries(categorySumsObj)
      .map(([key, value]) => `・${key}：${value}円`)
      .join("\n ");

  // 支出合計
  const expense = summaryInfo["支出"].number;
  const expensePrevMonthRate = summaryInfo["支出"].prevMonthRate;

  // 収入
  const income = summaryInfo["収入"].number;
  const incomePrevMonthRate = summaryInfo["収入"].prevMonthRate;
  // 収支
  const balance = income + expense;

  // 固定費
  const fixedCost = summaryInfo["固定費"].number;
  const fixedCostPrevMonthRate = summaryInfo["固定費"].prevMonthRate;
  // 変動費
  const variableCost = summaryInfo["変動費"].number;
  const variableCostPrevMonthRate = summaryInfo["変動費"].prevMonthRate;

  const data = {
    to: lineGroupId.value(),
    messages: [
      {
        type: "text",
        text: `!! これはテスト通知です。内容は正しくありません !!
🤓${targetDate.format("YYYY年M月")}の収支だよ〜

💴収支
  ${balance}円 ${balance > 0 ? "😆やった！プラスだ！" : "😭マイナスだよ〜"}
  
📈収入(前月比)
  ${income}円 (${incomePrevMonthRate}%)

📉支出(前月比)
  ${expense}円 (${expensePrevMonthRate}%)
  
  【内訳】
    🏠固定費
      ${fixedCost}円 (${fixedCostPrevMonthRate}%)
    🍞変動費
      ${variableCost}円 (${variableCostPrevMonthRate}%)
  
📝【カテゴリ別】
  ${categoryForReport}

内訳の詳細は以下URLから確認してね！:
${pdfUrl}

`,
      },
    ],
  };

  console.log(data.messages);

  try {
    await axios.post(lineApiUrl, data, {headers});
    console.log("LINEメッセージが送信されました");
  } catch (error) {
    console.error("LINEメッセージの送信に失敗しました:", error);
  }
}

