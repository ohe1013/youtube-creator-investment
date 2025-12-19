import * as dotenv from "dotenv";
import { searchChannels, getChannelStats } from "./lib/youtube";

dotenv.config();

async function test() {
  console.log("Testing YouTube API...");
  console.log("API Key present:", !!process.env.YOUTUBE_API_KEY);

  try {
    const ids = await searchChannels("Official Psy", { maxResults: 5 });
    console.log("Search IDs:", ids);

    if (ids.length > 0) {
      const stats = await getChannelStats(ids[0]);
      console.log("Stats:", stats);
    } else {
      console.log("No IDs found. Possible quota issue?");
    }
  } catch (e) {
    console.error("Full Error:", e);
  }
}

test();
