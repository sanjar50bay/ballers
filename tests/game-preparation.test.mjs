import assert from "node:assert/strict";
import { gamePreparation } from "../lib/game-preparation.ts";
const base = () => ({
  game: { format: 1 },
  teams: [
    { id: "a", name: "Blue", player_ids: ["p1"] },
    { id: "b", name: "Red", player_ids: ["p2"] },
    { id: "c", name: "Yellow", player_ids: [] },
  ],
  roles: [
    { team_id: "a", captain_id: "p1" },
    { team_id: "b", captain_id: "p2" },
  ],
  participants: [
    { player_id: "p1", attendance_status: "GOING" },
    { player_id: "p2", attendance_status: "GOING" },
  ],
  session: null,
  control: { leader_id: "p1" },
});
let count = 0;
function check(name, change, expected) {
  const s = base();
  change(s);
  const result = gamePreparation(s);
  for (const [k, v] of Object.entries(expected))
    assert.equal(result[k], v, `${name}: ${k}`);
  count++;
  console.log("PASS " + name);
}
check("ready starting pair does not require a full waiting team", () => {}, {
  ready: true,
});
check(
  "empty new day explains missing players, teams, captains and leader",
  (s) => {
    s.teams = [];
    s.roles = [];
    s.participants = [];
    s.control = undefined;
  },
  {
    ready: false,
    playersReady: false,
    teamsReady: false,
    captainsReady: false,
    leaderReady: false,
  },
);
check(
  "confirmed pool players do not count as a filled team",
  (s) => {
    s.teams[0].player_ids = [];
  },
  { playersReady: true, teamsReady: false, captainsReady: false, ready: false },
);
check(
  "a displayed player is not a saved captain",
  (s) => {
    s.roles = [];
  },
  { teamsReady: true, captainsReady: false, ready: false },
);
check(
  "a captain outside the team is not ready",
  (s) => {
    s.roles[0].captain_id = "p2";
  },
  { captainsReady: false, ready: false },
);
check(
  "declined players cannot make a starting roster ready",
  (s) => {
    s.participants[0].attendance_status = "DECLINED";
  },
  {
    playersReady: false,
    teamsReady: false,
    captainsReady: false,
    ready: false,
  },
);
check(
  "rotation checks the next pair, including the formerly waiting team",
  (s) => {
    s.session = { team_a: "b", team_b: "c" };
  },
  { playersReady: true, teamsReady: false, captainsReady: false, ready: false },
);
check(
  "an invalid session cannot silently fall back to the first pair",
  (s) => {
    s.session = { team_a: "a", team_b: "missing" };
  },
  { teamsReady: false, captainsReady: false, ready: false },
);
check(
  "the same team cannot play itself",
  (s) => {
    s.session = { team_a: "a", team_b: "a" };
  },
  { teamsReady: false, captainsReady: false, ready: false },
);
check(
  "captains cannot replace explicit leader assignment",
  (s) => {
    s.control = { leader_id: null };
  },
  { leaderReady: false, ready: false },
);
console.log(`RESULT: ${count} preparation checks passed.`);
