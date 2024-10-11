const {onSchedule} = require("firebase-functions/v2/scheduler");

// 前月の収支をレポートする関数
// notionDBから取得したデータから表を生成してpdfを生成してlineに送信する
exports.reportBalance =
    onSchedule({
      timeZone: "Asia/Tokyo",
      schedule: "0 8 1 * *", // 毎月1日 8:00に実行
    }, async (context) => {
      // ToDo: pdfkitを使って実装する
    });
