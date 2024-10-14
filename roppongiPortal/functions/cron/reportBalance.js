const {onSchedule} = require("firebase-functions/v2/scheduler");
const {Client} = require("@notionhq/client");
const {defineString} = require("firebase-functions/params");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const {Storage} = require("@google-cloud/storage");
const axios = require("axios");


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
    // Notionクライアントの初期化
      const notion = new Client({auth: notionApiKey.value()});
      // Notionからデータベースの情報を取得
      const response = await queryBalanceDB(notion);
      // responseをごにょごにょ
      console.log(response);

      const data = {
        columns: ["hoge", "huga", "piyo"],
        rows: [
          ["hoge1", "huga1", "piyo1"],
          ["hoge2", "huga2", "piyo2"],
          ["hoge3", "huga3", "piyo3"],
        ],
      };

      // PDFドキュメントの作成
      const doc = new PDFDocument();
      const pdfPath = path.join("/tmp", "report.pdf");
      const output = fs.createWriteStream(pdfPath);
      doc.pipe(output);

      const fontPath = path.join(__dirname, "NotoSansJP-VariableFont_wght.ttf");
      doc.font(fontPath);

      // タイトルと表を描画
      doc.fontSize(16).text("サンプルテーブル", {align: "center"});
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
      await sendLineMessage(publicUrl);
    });

/**
 *
 * @param {Client} notion notionクライアント
 */
async function queryBalanceDB(notion) {
  const response = await notion.databases.query({
    database_id: balanceDBId.value(),
    filter: {
      // todo: 適切なフィルタに修正する
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
                // contains: thisMonth,
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

  return response;
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
 */
async function sendLineMessage(pdfUrl) {
  const lineApiUrl = "https://api.line.me/v2/bot/message/push";
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${lineAccessToken.value()}`,
  };

  const data = {
    to: lineGroupId.value(),
    messages: [
      {
        type: "text",
        text: `

        前月の収支だよ〜 詳細は以下URLから確認してね！: ${pdfUrl}`,
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
