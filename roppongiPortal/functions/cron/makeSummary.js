const {onSchedule} = require("firebase-functions/v2/scheduler");
const {Client} = require("@notionhq/client");
const {defineString} = require("firebase-functions/params");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const {Storage} = require("@google-cloud/storage");
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
const balanceDBId = defineString("BALANCE_DB_ID");
const summaryDBId = defineString("SUMMARY_DB_ID");

// 月別・カテゴリ別集計を行い、MonthlySummaryDB, CategorySummaryDBに反映させる
// 先月の収支をPDFにまとめ、storageに格納する
exports.makeSummary =
    onSchedule({
      timeZone: "Asia/Tokyo",
      schedule: "0 1 1 * *", // 毎月1日 1:00に実行
    }, async (context) => {
      // const targetDate = dayjs.tz().subtract(1, "month");
      const targetDate = dayjs.tz();
      // Notionクライアントの初期化
      const notion = new Client({auth: notionApiKey.value()});
      // Notionからデータベースから情報を取得して収支サマリーを生成する前月分
      const allInfo = await makeReport(notion, targetDate);

      // PDF作成用
      const data = {
        columns: allInfo.detailReportsObj.detailReportHeaders,
        rows: allInfo.detailReportsObj.detailReports,
      };

      // PDFドキュメントの作成
      const doc = new PDFDocument();
      const pdfPath = path.join("/tmp", "report.pdf");
      const output = fs.createWriteStream(pdfPath);
      doc.pipe(output);

      const fontPath = path.join(__dirname, "NotoSansJP-VariableFont_wght.ttf");
      doc.font(fontPath);

      // タイトルと表を描画
      doc.fontSize(7)
          .text(`${targetDate.format("YYYY年M月")}の収支`, {align: "center"});
      doc.moveDown();
      createTable(doc, data);
      doc.end();

      await new Promise((resolve) => output.on("finish", resolve));

      // Firebase Storageにアップロード
      const destination = `reports/report-${targetDate.format("YYYYMM")}.pdf`;

      await storage.bucket(bucketName.value()).upload(pdfPath, {
        destination,
        metadata: {
          contentType: "application/pdf",
        },
      });

      const insertSummaryObj = allInfo.categorySumsObj;
      insertSummaryObj["収入"] = allInfo.summaryInfo.income;
      insertSummaryObj["固定費"] = allInfo.summaryInfo.fixedCost;
      insertSummaryObj["変動費"] = allInfo.summaryInfo.variableCost;
      insertSummaryObj["支出"] = insertSummaryObj["固定費"] +
        insertSummaryObj["変動費"];

      console.log(insertSummaryObj);

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

/**
 * 表を描画する関数
 * @param {PDFDocument} doc PDFドキュメント
 * @param {object} data 表の元となるデータ
 */
function createTable(doc, data) {
  const tableTop = 100;
  const columnSpacing = 70;
  const rowHeight = 15;
  const columnWidth = 70; // 列幅の定義

  let y = tableTop;

  // ヘッダー行の罫線
  data.columns.forEach((header, i) => {
    const x = i * columnSpacing + 50;
    doc.text(header, x, y);

    // ヘッダーの下に二重線を描画
    const lineY = y + rowHeight;

    // 1本目の線
    doc
        .moveTo(x, lineY)
        .lineTo(x + columnWidth, lineY)
        .stroke();

    // 2本目の線（少し下に引く）
    const secondLineY = lineY + 2; // 間隔を2ポイントに設定
    doc
        .moveTo(x, secondLineY)
        .lineTo(x + columnWidth, secondLineY)
        .stroke();
  });

  y += rowHeight + 2; // 2本目の線の分だけ余白を追加

  // データ行の描画と罫線
  data.rows.forEach((row) => {
    row.forEach((cell, i) => {
      const x = i * columnSpacing + 50;
      doc.text(cell, x, y);

      // 各セルに罫線を描画
      doc
          .moveTo(x, y + rowHeight) // 罫線の開始点
          .lineTo(x + columnWidth, y + rowHeight) // 罫線の終了点
          .stroke(); // 線を描画
    });
    y += rowHeight;
  });
}


