// earnings/fetchEarnings.mjs
import fs from "fs/promises";
import path from "path";
import axios from "axios";
import { CookieJar } from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";
import { WebhookClient, EmbedBuilder } from "discord.js";

const DISCORD_EARNINGS_WEBHOOK = process.env.DISCORD_EARNINGS_WEBHOOK;
if (!DISCORD_EARNINGS_WEBHOOK) {
  console.error("❌ Missing DISCORD_EARNINGS_WEBHOOK");
  process.exit(1);
}

const STATE_FILE = path.resolve("./whispers/earnings-state.json");
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const SLEEP_BETWEEN_SENDS = 3000;
const webhook = new WebhookClient({ url: DISCORD_EARNINGS_WEBHOOK });

async function loadState() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, "utf-8"));
  } catch {
    return [];
  }
}

async function saveState(state) {
  console.log(`Saving state to ${STATE_FILE}…`);
  const t0 = Date.now();
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`State saved in ${Date.now() - t0} ms`);
}

async function main() {
  const state = await loadState();
  const jar = new CookieJar();
  const client = wrapper(axios.create({ jar, withCredentials: true }));

  try {
    // 1) Warm cookies
    await client.get("https://www.earningswhispers.com/earningsnews", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    // 2) Fetch data
    const { data } = await client.get(
      "https://www.earningswhispers.com/api/todaysresults",
      {
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Accept-Language": "en-US,en;q=0.5",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          Referer: "https://www.earningswhispers.com/earningsnews",
          "X-Requested-With": "XMLHttpRequest",
        },
      }
    );

    // 3) Merge & send
    for (const item of data) {
      const exists = state.some(
        (e) => e.epsDate === item.epsDate && e.ticker === item.ticker
      );
      if (exists) continue;

      const statusEmoji =
        item.subject?.includes("Beat Expectations") ||
        item.subject?.includes("Beat Consensus Estimates")
          ? "🟢"
          : item.subject?.includes("Missed Expectations") ||
            item.subject?.includes("Missed Consensus Estimates")
          ? "🔴"
          : "🔵";

      const fmtMoney = (m) =>
        m == null
          ? "N/A"
          : m > 999
          ? `$${(m / 1000).toFixed(2)}B`
          : m >= 1
          ? `$${m.toFixed(2)}M`
          : `$${(m * 1000).toFixed(2)}K`;

      const embed = new EmbedBuilder()
        .setColor(0x1abc9c)
        .setTitle(`${statusEmoji} ${item.ticker} — ${item.subject}`)
        .setURL(`https://www.earningswhispers.com/epsdetails/${item.ticker}`)
        .setAuthor({ name: item.name || item.ticker })
        .addFields(
          {
            name: "Earnings Date",
            value: new Date(item.epsDate).toLocaleString(),
            inline: true,
          },
          {
            name: "EPS (est/whisp)",
            value: `${item.eps} (Estimate: ${item.estimate} / Whisper: ${item.whisper})`,
            inline: true,
          },
          { name: "Revenue", value: fmtMoney(item.revenue), inline: true },
          {
            name: "Revenue Estimate",
            value: fmtMoney(item.revenueEstimate),
            inline: true,
          },
          {
            name: "Earnings Surprise %",
            value:
              item.earningsSurprise != null
                ? `EPS ${(item.earningsSurprise * 100).toFixed(2)}%`
                : "N/A",
            inline: true,
          },
          {
            name: "Revenue Surprise %",
            value:
              item.revenueSurprise != null
                ? `${(item.revenueSurprise * 100).toFixed(2)}%`
                : "N/A",
            inline: true,
          },
          {
            name: "Previous Earnings Growth",
            value:
              item.prevEarningsGrowth != null
                ? `${(item.prevEarningsGrowth * 100).toFixed(1)}%`
                : "N/A",
            inline: true,
          },
          {
            name: "Previous Revenue Growth",
            value:
              item.prevRevenueGrowth != null
                ? `${(item.prevRevenueGrowth * 100).toFixed(1)}%`
                : "N/A",
            inline: true,
          },
          {
            name: "High / Low Est.",
            value: `${item.highEstimate} / ${item.lowEstimate}`,
            inline: true,
          },
          {
            name: "Earnings Whispers Grade",
            value: item.ewGrade || "N/A",
            inline: true,
          },
          {
            name: "Power Rating",
            value: item.pwrRating || "N/A",
            inline: true,
          },
          {
            name: "Conference Call",
            value: item.fileName
              ? `[Link](https://app.webinar.net/${item.fileName})`
              : "N/A",
            inline: true,
          }
        )
        .setDescription(
          (item.summary || "")
            .replace(/<br \/>/g, "\n")
            .replace(/<a [^>]+>([^<]+)<\/a>/g, "[$1]")
        )
        .setFooter({ text: "Source: Earnings Whispers" })
        .setTimestamp();

      await webhook.send({
        embeds: [embed],
        allowed_mentions: { parse: [] },
      });

      state.push(item);
      console.log(`✔ Posted: ${item.ticker} (${item.epsDate})`);
      await sleep(SLEEP_BETWEEN_SENDS);
    }
  } catch (error) {
    console.error("❌ Error fetching earnings:", error);
  } finally {
    await saveState(state);
    console.log(`Total records: ${state.length}`);
    await webhook.destroy?.();
  }
}

main().catch(async (err) => {
  console.error(err);
  await webhook.destroy?.();
  process.exit(1);
});


/**
 * example of earning report json response from the url https://www.earningswhispers.com/api/todaysresults: 
 * 
 * [
	{
		"epsDate": "2025-07-27T12:50:00",
		"ticker": "CNC",
		"name": "Centene Corporation",
		"summary": "Centene (CNC) reported a loss of $0.16 per share on revenue of $48.74 billion for the .  The consensus earnings estimate was $0.68 per share on  revenue of $44.28 billion. The company missed consensus estimates by 123.53% while revenue grew 22.36% on a year-over-year basis.<br /><br />The company  said during its <a href=\"https://app.webinar.net/NR6KbwxLVn8\">conference call</a> it expects  2025  earnings of approximately $1.75 per share. The company previously withdrew its initial guidance for earnings of at least $7.25 per share and the current consensus earnings estimate is $3.55 per share for the year ending December 31, 2025.<br /><br />Centene Corp is a diversified multi-national healthcare enterprise. The Company provides programs and services to government sponsored healthcare\r\nprograms, focusing on under-insured and uninsured individuals.",
		"subject": "Centene Missed Consensus Estimates",
		"quarter": "",
		"fileName": "2507277994",
		"eps": -0.16,
		"ewGrade": null,
		"pwrRating": null,
		"estimate": 0.68,
		"whisper": 999,
		"highEstimate": 2.1,
		"lowEstimate": 0.3,
		"revenue": 48742.0,
		"revenueEstimate": 44280.0,
		"earningsGrowth": -1.0661157024793389,
		"revenueGrowth": 0.22356662315493523,
		"earningsSurprise": -1.2352941176470589,
		"revenueSurprise": 0.10076784101174345,
		"prevEarningsGrowth": null,
		"prevRevenueGrowth": 0.153760487044324
	},
	{
		"epsDate": "2025-07-25T07:30:00",
		"ticker": "HCA",
		"name": "HCA Healthcare, Inc.",
		"summary": "HCA Healthcare (HCA) reported earnings of $6.84 per share on revenue of $18.61 billion for the .  The consensus earnings estimate was $6.19 per share on  revenue of $18.46 billion. The Earnings Whisper number was $6.35 per share. The company beat expectations by 7.72% while revenue grew 6.36% on a year-over-year basis.<br /><br />The company  said it expects  2025  earnings of $25.50 to $27.00 per share on revenue of $74.00 billion to $76.00 billion. The company's previous guidance was  earnings of $24.05 to $25.85 per share on revenue of $72.80 billion to $75.80 billion and the current consensus earnings estimate is $25.30 per share on revenue of $74.60 billion for the year ending December 31, 2025.<br /><br />HCA Holdings Inc is a health care services company. It operates general\r\nacute care hospitals, psychiatric hospitals; and rehabilitation hospitals. It\r\nalso operates freestanding surgery centers.",
		"subject": "HCA Healthcare Beat Expectations",
		"quarter": "",
		"fileName": "2507259537",
		"eps": 6.84,
		"ewGrade": null,
		"pwrRating": null,
		"estimate": 6.19,
		"whisper": 6.35,
		"highEstimate": 6.51,
		"lowEstimate": 5.6,
		"revenue": 18605.0,
		"revenueEstimate": 18460.0,
		"earningsGrowth": 0.24363636363636363,
		"revenueGrowth": 0.06362908758289504,
		"earningsSurprise": 0.07716535433070866,
		"revenueSurprise": 0.007854821235102925,
		"prevEarningsGrowth": null,
		"prevRevenueGrowth": 0.05663533075725244
	}
]
 * 
 */