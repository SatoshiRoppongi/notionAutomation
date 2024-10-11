const {onSchedule} = require("firebase-functions/v2/scheduler");
const PDFDocument = require("pdfkit");
const fs = require("fs");

// 前月の収支をレポートする関数
// notionDBから取得したデータから表を生成してpdfを生成してlineに送信する
exports.reportBalance =
    onSchedule({
      timeZone: "Asia/Tokyo",
      schedule: "0 8 1 * *", // 毎月1日 8:00に実行
    }, async (context) => {
      // ToDo: balanceDBから取得した値で下記オブジェクトを構成する
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

      // 出力先ファイルを設定
      const output = fs.createWriteStream("report.pdf");
      doc.pipe(output);

      // タイトル
      doc.fontSize(16).text("sample table", {align: "center"});
      doc.moveDown();
      // 表をPDFに追加
      createTable(doc, data);

      // PDFの終了
      doc.end();


      // 終了後の処理
      output.on("finish", () => {
        console.log("PDFが生成されました");
      });
    });

/**
 * 表を描画する関数
 * @param {PDFDocument} doc PDFドキュメント
 * @param {object} data 表の元となるデータ
 */
function createTable(doc, data) {
  const tableTop = 100; // 表の開始位置
  const columnSpacing = 150; // 列の幅
  const rowHeight = 30; // 行の高さ

  // ヘッダーの描画
  let y = tableTop;
  data.columns.forEach((header, i) => {
    doc.text(header, i * columnSpacing + 50, y);
  });
  y += rowHeight;

  // 行の描画
  data.rows.forEach((row) => {
    row.forEach((cell, i) => {
      doc.text(cell, i * columnSpacing + 50, y);
    });
    y += rowHeight;
  });
}
