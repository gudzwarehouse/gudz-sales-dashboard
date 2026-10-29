import { ALL_CHANNELS } from "../server/channels";
import {
  CACHE_MIN_AGE_DAYS,
  isEntry,
  loadDayCache,
  saveDayCache,
} from "../server/cache";
import {
  addDays,
  eachDay,
  londonDayStartUtc,
  londonToday,
  resolveRange,
} from "../server/dates";
import { buildChannels, fetchDays, findConfigErrors } from "../server/sales";

// Gatsby only inlines static process.env.X references, so they are read here.
function readCredentials() {
  return {
    accounts: {
      UK: {
        applicationId: process.env.GATSBY_CA_UK_APPLICATION_ID,
        sharedSecret: process.env.GATSBY_CA_UK_SHARED_SECRET,
        refreshToken: process.env.GATSBY_CA_UK_REFRESH_TOKEN,
        profileId: process.env.GATSBY_CA_UK_PROFILE_ID,
      },
      IRE: {
        applicationId: process.env.GATSBY_CA_IRE_APPLICATION_ID,
        sharedSecret: process.env.GATSBY_CA_IRE_SHARED_SECRET,
        refreshToken: process.env.GATSBY_CA_IRE_REFRESH_TOKEN,
        profileId: process.env.GATSBY_CA_IRE_PROFILE_ID,
      },
    },
    mirakl: {
      tesco: {
        apiKey: process.env.GATSBY_MIRAKL_TESCO_API_KEY,
        baseUrl: process.env.GATSBY_MIRAKL_TESCO_BASE_URL,
      },
      superdrug: {
        apiKey: process.env.GATSBY_MIRAKL_SUPERDRUG_API_KEY,
        baseUrl: process.env.GATSBY_MIRAKL_SUPERDRUG_BASE_URL,
      },
    },
  };
}

function findNeededDays({ wanted, cache, cacheableUpTo, refresh }) {
  const needed = {};
  for (const { key } of ALL_CHANNELS) {
    needed[key] = wanted.filter(
      (day) => refresh || day > cacheableUpTo || !isEntry(cache[day]?.[key]),
    );
  }
  return needed;
}

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("Cache-Control", "no-store");

  try {
    const { accounts, mirakl } = readCredentials();
    const errors = findConfigErrors(accounts, mirakl);

    const query = req.query || {};
    const today = londonToday();
    const range = resolveRange(query, today);
    if (range.error) return res.status(400).json({ error: range.error });
    const { from, to } = range;

    const cache = loadDayCache();
    const cacheableUpTo = addDays(today, -CACHE_MIN_AGE_DAYS);
    const wanted = eachDay(from, to);
    const needed = findNeededDays({
      wanted,
      cache,
      cacheableUpTo,
      refresh: query.refresh,
    });
    const keys = new Set(
      ALL_CHANNELS.map((c) => c.key).filter(
        (key) => needed[key].length && !errors[key],
      ),
    );

    const fresh = {};
    if (keys.size) {
      const neededDays = [...keys].flatMap((key) => needed[key]).sort();
      const fetched = await fetchDays(
        neededDays[0],
        neededDays[neededDays.length - 1],
        { accounts, mirakl, keys },
      );
      Object.assign(errors, fetched.errors);

      let cacheChanged = false;
      for (const key of keys) {
        if (errors[key]) continue;
        for (const [day, entries] of Object.entries(fetched.days)) {
          (fresh[day] ||= {})[key] = entries[key];
          if (day <= cacheableUpTo) {
            cache[day] = { ...cache[day], [key]: entries[key] };
            cacheChanged = true;
          }
        }
      }
      if (cacheChanged) saveDayCache();
    }

    const channels = buildChannels({ wanted, fresh, cache, errors });
    if (channels.every((c) => c.error)) {
      return res.status(502).json({
        error: `Could not load any channel. ${channels[0].label}: ${channels[0].error}`,
        channels,
      });
    }

    res.status(200).json({
      from,
      to,
      since: londonDayStartUtc(from),
      until: londonDayStartUtc(addDays(to, 1)),
      channels,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Unexpected server error" });
  }
}
