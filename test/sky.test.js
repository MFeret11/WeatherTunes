// The sky maths against events with published times.
import { test, assert } from "./harness.js";
import {
  moonDay, seasonPoint, meteorShower, magneticLatitude, auroraReach, elongation, illumination, localMidnight, zoneOffset,
} from "../src/sky.js";

const utc = (s) => Date.parse(s + "Z");
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);
const dayOf = (date, tz) => localMidnight(date, tz).start;

test("moon phase angle at known new and full moons", () => {
  near(elongation(utc("2025-10-07T03:48")), 180, 1, "full moon 7 Oct 2025");
  near(elongation(utc("2025-10-21T12:25")), 360 * (elongation(utc("2025-10-21T12:25")) > 180), 1, "new moon 21 Oct 2025");
  near(illumination(utc("2025-10-07T03:48")), 1, 0.01, "full moon is fully lit");
  near(illumination(utc("2025-10-21T12:25")), 0, 0.01, "new moon is dark");
});

test("main phases are named on the day they happen", () => {
  assert(moonDay(40, -75.2, dayOf("2025-10-06", "America/New_York")).phase === "full moon", "full on 6 Oct in Philadelphia (11:48 pm local)");
  assert(moonDay(40, -75.2, dayOf("2025-10-07", "America/New_York")).phase === "waning gibbous", "waning the next day");
  assert(moonDay(40, -75.2, dayOf("2025-10-21", "America/New_York")).phase === "new moon", "new on 21 Oct");
  assert(moonDay(40, -75.2, dayOf("2025-10-24", "America/New_York")).phase === "waxing crescent", "crescent three days later");
});

test("a full moon rises around sunset", () => {
  const m = moonDay(40, -75.2, dayOf("2025-11-05", "America/New_York")); // full moon 5 Nov 2025, sunset ~4:56 pm
  assert(m.rise != null && Math.abs(m.rise - 16.9) < 1.2, `rise ${m.rise}`);
});

test("lunar eclipses: found, typed and placed", () => {
  const e1 = moonDay(40, -75.2, dayOf("2025-03-14", "America/New_York")).eclipse; // total, 06:58 UTC = 2:58 am EDT
  assert(e1 && e1.type === "total" && e1.visible, `14 Mar 2025 ${JSON.stringify(e1)}`);
  near(e1.hour, 3, 1, "14 Mar 2025 time");
  const e2 = moonDay(19.1, 72.9, dayOf("2025-09-07", "Asia/Kolkata")).eclipse; // total, 18:11 UTC = 11:41 pm IST
  assert(e2 && e2.type === "total" && e2.visible, `7 Sep 2025 from Mumbai ${JSON.stringify(e2)}`);
  const e3 = moonDay(40, -75.2, dayOf("2025-09-07", "America/New_York")).eclipse; // daytime in Philadelphia
  assert(e3 && !e3.visible, "7 Sep 2025 not visible from Philadelphia");
  const e4 = moonDay(40, -75.2, dayOf("2026-08-28", "America/New_York")).eclipse; // deep partial, 04:12 UTC
  assert(e4 && e4.type === "partial", `28 Aug 2026 ${JSON.stringify(e4)}`);
  for (const d of ["2025-10-06", "2025-11-05", "2026-01-03"]) {
    assert(!moonDay(40, -75.2, dayOf(d, "America/New_York")).eclipse, `no eclipse at the ${d} full moon`);
  }
});

test("solstices and equinoxes land on the right local day", () => {
  const s = seasonPoint(40, dayOf("2025-06-20", "America/New_York")); // 02:42 UTC on the 21st = 10:42 pm EDT on the 20th
  assert(s && s.kind === "solstice" && s.longest === true, `June solstice ${JSON.stringify(s)}`);
  assert(!seasonPoint(40, dayOf("2025-06-21", "America/New_York")), "not the next day in Philadelphia");
  const sy = seasonPoint(-33.9, dayOf("2025-06-21", "Australia/Sydney"));
  assert(sy && sy.longest === false && /shortest/.test(sy.meaning), "shortest day in Sydney");
  assert(seasonPoint(51.5, dayOf("2025-09-22", "Europe/London"))?.kind === "equinox", "September equinox");
  assert(seasonPoint(51.5, dayOf("2025-12-21", "Europe/London"))?.name === "December solstice", "December solstice");
});

test("meteor showers by date and latitude", () => {
  assert(meteorShower("2025-08-12", 40)?.name === "Perseids", "Perseids");
  assert(meteorShower("2025-08-12", -40) === null, "Perseids too low to see from 40° south");
  assert(meteorShower("2025-12-14", -33.9)?.name === "Geminids", "Geminids from Sydney");
  assert(meteorShower("2025-10-16", 40) === null, "nothing on 16 Oct");
});

test("aurora reach follows magnetic latitude and activity", () => {
  near(magneticLatitude(64.1, -21.9), 69.5, 2, "Reykjavik");
  near(magneticLatitude(40, -75.2), 50, 2.5, "Philadelphia");
  assert(auroraReach(magneticLatitude(64.1, -21.9), 2) === 1, "Reykjavik sees it on a quiet night");
  assert(auroraReach(magneticLatitude(40, -75.2), 3) === 0, "Philadelphia doesn't at Kp 3");
  assert(auroraReach(magneticLatitude(40, -75.2), 8) > 0, "...but does in a big storm");
});

test("time zone offsets follow daylight saving", () => {
  assert(zoneOffset("Europe/Oslo", Date.UTC(2025, 0, 6, 12)) === 60, "Oslo in January is UTC+1");
  assert(zoneOffset("Europe/Oslo", Date.UTC(2025, 6, 6, 12)) === 120, "and UTC+2 in July");
  assert(localMidnight("2025-01-06", "Europe/Oslo").start === Date.UTC(2025, 0, 5, 23), "Oslo midnight");
});
