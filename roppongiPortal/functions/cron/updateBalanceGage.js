
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


const notionApiKey = defineString("NOTION_API_KEY");
// 収支DBのID
const balanceDBId = defineString("BALANCE_DB_ID");

// 固定費マスタを収支DBにコピーする関数
exports.updateBalanceGage =
  onSchedule({
    timeZone: "Asia/Tokyo",
    schedule: "0 2 * * *", // 毎日2時に実行
  }, async (context) => {
    // Notionクライアントの初期化
    const notion = new Client({auth: notionApiKey.value()});
    // Notionからデータベースの情報を取得
    const today = dayjs.tz();
    const thisMonth9th = today.date(9);

    // 基準月 今月10日を基準とする
    const baseMonthDate = today.isAfter(thisMonth9th, "day") ?
            today : today.subtract(1, "month");

    const startDate = baseMonthDate.date(10);
    const endDate = startDate.add(1, "month");

    const startDateUTC = startDate.utc().startOf("day").
        format("YYYY-MM-DDTHH:mm:ss[Z]");
    const endDateUTC = endDate.utc().startOf("day").
        format("YYYY-MM-DDTHH:mm:ss[Z]");


    const queryResults = await notion.databases.query({
      database_id: balanceDBId.value(),
      filter: {
        and: [
          {
            property: "実行年月日",
            date: {
              "on_or_after": startDateUTC,
            },
          },
          {
            property: "実行年月日",
            date: {
              "before": endDateUTC,
            },
          },
        ],
      },
    });

    const records = queryResults.results;

    let income = 0;
    let expense = 0;

    for (const record of records) {
      const properties = record.properties;
      if (properties["ステータス"].formula.string == "未実行") {
        // 未完了の処理`
      } else {
        // 本日実行 or 完了
        const amount = properties["収支"].formula.number;
        if (amount > 0) {
          income += amount;
        } else {
          expense += amount;
        }
      }
    }

    const remainingAmount = income + expense;

    const batteryRemains = income > 0 ?
      Math.round(remainingAmount * 100 / income) : 0;

    const remainPart = Math.round(batteryRemains / 5);
    const complementPart = 20 - remainPart;

    const batteryDisplay = "   [" +
      "|".repeat(remainPart) +
      " ".repeat(complementPart) +
      "]";

    const displayColor = batteryRemains >= 70 ? "green" :
      batteryRemains >= 30 ? "yellow" :
        "red";

    // 残り日数に関する情報
    const remainingDays = endDate.diff(today, "day");
    let remainingDaysComment;
    if (remainingDays > 20) {
      remainingDaysComment = "計画的にいきましょう🤓";
    } else if (remainingDays > 10) {
      remainingDaysComment = "大きな支出に注意しよう🧐";
    } else {
      remainingDaysComment = "もうちょっとだ！頑張れ！🔥";
    }
    const remainingDaysString =
      `残り ${remainingDays} 日! ${remainingDaysComment}`;

    // 残金に関する情報
    const remainingAmountComment = batteryRemains >= 70 ?
      "まだまだ余裕はある！無駄遣いはせず 🤩" :
      batteryRemains >= 30 ? "支出オーバーしないか確認してね 🙂" :
        batteryRemains > 0 ? "もうすぐ無くなりそうだよ🥶" :
        "なくなったー😵 原因を話し合って、次回から気をつけよう";
    const remainingAmountString =
      `残り ${remainingAmount} 円! ${remainingAmountComment}`;


    // const pageId = householdTopId.value();
    // blockIdはnotion上で6点リーダーをクリックして「ブロックへのリンク」から取得可能
    const batteryBlockId = "12934c95-cc30-80a0-a4cd-c9934f6913b3";
    const remainingDaysBlockId = "12934c95cc30800db401ce49e20f9db4";
    const remainingAmountBlockId = "12934c95cc3080f08b97eb3d1adabbbe";
    // ゲージの更新
    await notion.blocks.update({
      block_id: batteryBlockId,
      heading_1: {
        rich_text: [
          {
            text: {
              content: batteryDisplay,
            },
            annotations: {
              color: displayColor,
            },
          },
          {
            text: {
              content: ` ${batteryRemains}%`,
            },
          },
        ],
      },
    }),
    // 残り日数の更新
    await notion.blocks.update({
      block_id: remainingDaysBlockId,
      bulleted_list_item: {
        rich_text: [
          {
            text: {
              content: remainingDaysString,
            },
          },
        ],
      },
    });
    // 残金の更新
    await notion.blocks.update({
      block_id: remainingAmountBlockId,
      bulleted_list_item: {
        rich_text: [
          {
            text: {
              content: remainingAmountString,
            },
          },
        ],
      },
    });
  });


