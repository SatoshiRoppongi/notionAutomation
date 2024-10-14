const {onSchedule} = require("firebase-functions/v2/scheduler");
const {Client} = require("@notionhq/client");
const {defineString} = require("firebase-functions/params");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
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
const balanceDBId = defineString("BALANCE_DB_ID");

// 前月の収支をレポートする関数
exports.reportBalance =
    onSchedule({
      timeZone: "Asia/Tokyo",
      schedule: "0 8 1 * *", // 毎月1日 8:00に実行
    }, async (context) => {
      // todo: 稼働する際は前月にする必要がある
      const targetDate = dayjs.tz();
      // Notionクライアントの初期化
      const notion = new Client({auth: notionApiKey.value()});
      // Notionからデータベースから情報を取得して収支サマリーを生成する前月分
      const allInfo = await makeReport(notion, targetDate);
      console.log(allInfo);

      // todo: 来月の予告も取得してレポートに追加する

      const data = {
        columns: allInfo.detailReportsObj.detailReportHeaders,
        rows: allInfo.detailReportsObj.detailReports,
      };

      console.log(data);


      // PDFドキュメントの作成
      const doc = new PDFDocument();
      const pdfPath = path.join("/tmp", "report.pdf");
      const output = fs.createWriteStream(pdfPath);
      // const output = fs.createWriteStream("report.pdf");
      doc.pipe(output);

      const fontPath = path.join(__dirname, "NotoSansJP-VariableFont_wght.ttf");
      doc.font(fontPath);

      // タイトルと表を描画
      doc.fontSize(8)
          .text(`${targetDate.format("YYYY年M日")}の収支`, {align: "center"});
      doc.moveDown();
      createTable(doc, data);
      doc.end();

      await new Promise((resolve) => output.on("finish", resolve));

      // Firebase Storageにアップロード
      const destination = `reports/report-${Date.now()}.pdf`;

      await storage.bucket(bucketName.value()).upload(pdfPath, {
        destination,
        metadata: {
          contentType: "application/pdf",
        },
      });


      // アップロードしたファイルの公開URLを取得
      const file = storage.bucket(bucketName.value()).file(destination);
      await file.makePublic();
      const publicUrl = file.publicUrl();

      // LINEグループにメッセージを送信
      await sendLineMessage(
          publicUrl, allInfo.summaryInfo, allInfo.categorySumsObj, targetDate);
    });

/**
 *
 * @param {Client} notion notionクライアント
 * @param {dayjs.Dayjs} targetDate 対象年月日
 */
async function makeReport(notion, targetDate) {
  const thisYear = targetDate.format("YYYY年");
  const thisMonth = targetDate.format("M月");

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
    categorySumsObj[category.name] = 0;
  }

  const queryResults = await notion.databases.query({
    database_id: balanceDBId.value(),
    filter: {
      // todo: 適切なフィルタに修正する
      property: "実行年月日",
      rich_text: {
        contains: thisYear + thisMonth,
      },
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
    const amount = properties["収支"].number;
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

      // カテゴリ別集計
      categorySumsObj[properties["分類"].select.name] +=
        properties["収支"].number;
    }

    // レポートで出力する順番にカラムを並び替える
    // レポートで出力する形式に変換する
    const arrangedRecordList = detailReportHeaders.map(
        (propertyName) => {
          const property = properties[propertyName];
          let retValue;
          switch (property.type) {
            case "title":
              retValue = property.title[0].text.content;
              break;
            case "number":
              retValue = property.number;
              break;
            case "select":
              retValue = property.select.name;
              break;
            case "formula":
              retValue = property.formula.string;
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


/**
 * 表を描画する関数
 * @param {PDFDocument} doc PDFドキュメント
 * @param {object} data 表の元となるデータ
 */
function createTable(doc, data) {
  const tableTop = 100;
  const columnSpacing = 150;
  const rowHeight = 30;

  let y = tableTop;
  data.columns.forEach((header, i) => {
    doc.text(header, i * columnSpacing + 50, y);
  });
  y += rowHeight;

  data.rows.forEach((row) => {
    row.forEach((cell, i) => {
      doc.text(cell, i * columnSpacing + 50, y);
    });
    y += rowHeight;
  });
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
      .map(([key, value]) => `${key}：${value}円`)
      .join("\n  ");

  const data = {
    to: lineGroupId.value(),
    messages: [
      {
        type: "text",
        text: `!! これはテスト通知です。内容は正しくありません !!
${targetDate.format("YYYY年M月")}の収支だよ〜

🟢収入
${summaryInfo.income}円
🔴支出
  🏠固定費
  ${summaryInfo.fixedCost}円
  🍞変動費
  ${summaryInfo.variableCost}円
    
  [カテゴリ別]
  ${categoryForReport}

内訳の詳細は以下URLから確認してね！:
${pdfUrl}`,
      },
    ],
  };

  try {
    await axios.post(lineApiUrl, data, {headers});
    console.log("LINEメッセージが送信されました");
  } catch (error) {
    console.error("LINEメッセージの送信に失敗しました:", error);
  }
}
