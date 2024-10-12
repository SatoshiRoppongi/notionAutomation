const functions = require("firebase-functions");

exports.getLineGroupIds = functions.https.onRequest(async (req, res) => {
  const events = req.body.events;

  events.forEach((event) => {
    // グループからのメッセージかどうかを確認
    if (event.source.type === "group") {
      const groupId = event.source.groupId;
      console.log("グループID:", groupId);
    }
  });

  res.status(200).send("OK");
});
