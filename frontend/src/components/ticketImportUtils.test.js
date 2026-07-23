import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTicketGroups,
  buildTicketImportPayload,
  getTicketConnection,
  mergeTicketPdfFiles,
  moveTicketCandidate,
  normalizeTicketCandidates,
  normalizeStationName,
  removeTicketCandidate,
  sortTicketCandidates,
  shouldMergeTicketGroup,
  validateTicketCandidates,
} from "./ticketImportUtils.js";

const ticket = (overrides = {}) => ({
  id: overrides.id || Math.random().toString(36),
  travel_date: "2026-07-10",
  depart_station: "杭州",
  arrive_station: "南京南",
  amount: "125.00",
  ...overrides,
});

describe("ticket import utilities", () => {
  it("accepts only unique PDF files", () => {
    const first = { name: "a.PDF", type: "", size: 10, lastModified: 1 };
    const duplicate = { ...first };
    const byMime = { name: "ticket", type: "application/pdf", size: 20, lastModified: 2 };
    const image = { name: "ticket.png", type: "image/png", size: 30, lastModified: 3 };
    const result = mergeTicketPdfFiles([first], [duplicate, byMime, image]);

    assert.deepEqual(result.files, [first, byMime]);
    assert.deepEqual(result.duplicates, [duplicate]);
    assert.deepEqual(result.rejected, [image]);
  });

  it("normalizes station suffixes and whitespace conservatively", () => {
    assert.equal(normalizeStationName(" 南京 南 站 "), "南京南");
    assert.notEqual(normalizeStationName("南京站"), normalizeStationName("南京南站"));
  });

  it("connects consecutive stations only on the same or following day", () => {
    const first = ticket();
    assert.deepEqual(
      getTicketConnection(first, ticket({ id: "same", depart_station: "南京南站", arrive_station: "芜湖" })),
      { crossDay: false, dayGap: 0 },
    );
    assert.deepEqual(
      getTicketConnection(
        first,
        ticket({ id: "next", travel_date: "2026-07-11", depart_station: "南京南", arrive_station: "芜湖" }),
      ),
      { crossDay: true, dayGap: 1 },
    );
    assert.equal(
      getTicketConnection(
        first,
        ticket({ id: "far", travel_date: "2026-07-12", depart_station: "南京南", arrive_station: "芜湖" }),
      ),
      null,
    );
    assert.equal(
      getTicketConnection(
        first,
        ticket({ id: "backdated", travel_date: "2026-07-09", depart_station: "南京南", arrive_station: "芜湖" }),
      ),
      null,
    );
    assert.equal(getTicketConnection(first, ticket({ id: "disconnected", depart_station: "南京", arrive_station: "芜湖" })), null);
    assert.equal(
      getTicketConnection(first, ticket({ id: "duplicate", depart_station: "南京南", arrive_station: "芜湖", duplicate: true })),
      null,
    );
  });

  it("builds same-day and next-day transfer groups with merging enabled by default", () => {
    const tickets = [
      ticket({ id: "a" }),
      ticket({ id: "b", depart_station: "南京南", arrive_station: "芜湖", amount: "50" }),
      ticket({ id: "c", travel_date: "2026-07-11", depart_station: "芜湖", arrive_station: "合肥", amount: "60" }),
    ];
    const [group] = buildTicketGroups(tickets);

    assert.deepEqual(group.path, ["杭州", "南京南", "芜湖", "合肥"]);
    assert.equal(group.total_amount, "235.00");
    assert.equal(group.cross_day, true);
    assert.equal(group.suggested_merge, true);
    assert.equal(shouldMergeTicketGroup(group), true);

    const split = buildTicketGroups(tickets, { breakAfterIds: ["b"] });
    assert.deepEqual(split.map((item) => item.ticket_ids), [["a", "b"], ["c"]]);
  });

  it("splits before tickets that return to an already visited station", () => {
    const thereAndBack = buildTicketGroups([
      ticket({ id: "a" }),
      ticket({ id: "b", depart_station: "南京南", arrive_station: "杭州站" }),
    ]);
    assert.deepEqual(thereAndBack.map((group) => group.ticket_ids), [["a"], ["b"]]);
    assert.equal(thereAndBack[1].route_loop, true);
    assert.equal(shouldMergeTicketGroup(thereAndBack[1]), false);

    const route = buildTicketGroups([
      ticket({ id: "a" }),
      ticket({ id: "b", depart_station: "南京南", arrive_station: "芜湖" }),
      ticket({ id: "c", depart_station: "芜湖", arrive_station: "杭州站" }),
      ticket({ id: "d", depart_station: "杭州", arrive_station: "绍兴" }),
      ticket({ id: "e", depart_station: "绍兴", arrive_station: "宁波" }),
    ]);
    assert.deepEqual(route.map((group) => group.ticket_ids), [["a", "b"], ["c"], ["d", "e"]]);
    assert.equal(route[1].route_loop, true);
    assert.equal(shouldMergeTicketGroup(route[0]), true);
    assert.equal(shouldMergeTicketGroup(route[2]), true);

    const returnsToMiddle = buildTicketGroups([
      ticket({ id: "a" }),
      ticket({ id: "b", depart_station: "南京南", arrive_station: "芜湖" }),
      ticket({ id: "c", depart_station: "芜湖", arrive_station: "南京南站" }),
    ]);
    assert.deepEqual(returnsToMiddle.map((group) => group.ticket_ids), [["a", "b"], ["c"]]);
    assert.equal(returnsToMiddle[1].route_loop, true);
  });

  it("normalizes in upload order and drops departure time", () => {
    const first = ticket({ id: "first", travel_date: "2026-07-11", depart_time: "15:00" });
    const second = ticket({ id: "second", travel_date: "2026-07-10", depart_time: "08:00" });
    const candidates = normalizeTicketCandidates([first, second]);

    assert.deepEqual(candidates.map((item) => item.id), ["first", "second"]);
    assert.equal("depart_time" in candidates[0], false);
  });

  it("sorts a shuffled three-ticket component along its unique route", () => {
    const candidates = [
      ticket({ id: "middle", depart_station: "南京南", arrive_station: "芜湖" }),
      ticket({ id: "last", depart_station: "芜湖", arrive_station: "合肥南" }),
      ticket({ id: "first", depart_station: "杭州西", arrive_station: "南京南" }),
    ];

    assert.deepEqual(sortTicketCandidates(candidates).map((item) => item.id), ["first", "middle", "last"]);
  });

  it("orders route components by their earliest date and original index", () => {
    const candidates = [
      ticket({ id: "later", travel_date: "2026-03-20", depart_station: "泰州", arrive_station: "杭州东" }),
      ticket({ id: "middle", travel_date: "2026-03-18", depart_station: "常熟", arrive_station: "泰州" }),
      ticket({ id: "first", travel_date: "2026-03-18", depart_station: "杭州西", arrive_station: "常熟" }),
    ];

    const sorted = sortTicketCandidates(candidates);
    assert.deepEqual(sorted.map((item) => item.id), ["first", "middle", "later"]);
    assert.deepEqual(buildTicketGroups(sorted).map((group) => group.ticket_ids), [["first", "middle"], ["later"]]);
  });

  it("sorts a unique route across consecutive dates", () => {
    const candidates = [
      ticket({ id: "next-day", travel_date: "2026-07-11", depart_station: "南京南", arrive_station: "芜湖" }),
      ticket({ id: "same-day", travel_date: "2026-07-10", depart_station: "杭州", arrive_station: "南京南" }),
    ];

    assert.deepEqual(sortTicketCandidates(candidates).map((item) => item.id), ["same-day", "next-day"]);
  });

  it("does not guess the order inside a branching route component", () => {
    const candidates = [
      ticket({ id: "branch-one", depart_station: "南京南", arrive_station: "芜湖" }),
      ticket({ id: "root", depart_station: "杭州", arrive_station: "南京南" }),
      ticket({ id: "branch-two", depart_station: "南京南", arrive_station: "合肥南" }),
    ];

    assert.deepEqual(sortTicketCandidates(candidates).map((item) => item.id), ["branch-one", "root", "branch-two"]);
  });

  it("preserves component order when the route forms a cycle", () => {
    const candidates = [
      ticket({ id: "middle", depart_station: "南京南", arrive_station: "芜湖" }),
      ticket({ id: "return", depart_station: "芜湖", arrive_station: "杭州" }),
      ticket({ id: "outbound", depart_station: "杭州", arrive_station: "南京南" }),
    ];

    assert.deepEqual(sortTicketCandidates(candidates).map((item) => item.id), ["middle", "return", "outbound"]);
  });

  it("keeps manual moves because grouping does not reapply automatic sorting", () => {
    const automaticallySorted = sortTicketCandidates([
      ticket({ id: "middle", depart_station: "南京南", arrive_station: "芜湖" }),
      ticket({ id: "first", depart_station: "杭州", arrive_station: "南京南" }),
      ticket({ id: "last", depart_station: "芜湖", arrive_station: "合肥南" }),
    ]);
    const manuallyMoved = moveTicketCandidate(automaticallySorted, 0, 1);

    assert.deepEqual(manuallyMoved.map((item) => item.id), ["middle", "first", "last"]);
    assert.deepEqual(
      buildTicketGroups(manuallyMoved).flatMap((group) => group.ticket_ids),
      ["middle", "first", "last"],
    );
  });

  it("recalculates grouping after station or date corrections", () => {
    const first = ticket({ id: "a" });
    const incomplete = ticket({ id: "b", depart_station: "", arrive_station: "芜湖" });
    assert.deepEqual(buildTicketGroups([first, incomplete]).map((group) => group.ticket_ids), [["a"], ["b"]]);

    const corrected = { ...incomplete, depart_station: "南京南站", travel_date: "2026-07-11" };
    const [group] = buildTicketGroups([first, corrected]);
    assert.deepEqual(group.ticket_ids, ["a", "b"]);
    assert.equal(group.cross_day, true);
    assert.equal(shouldMergeTicketGroup(group), true);
  });

  it("validates required fields without requiring a departure time", () => {
    const valid = ticket({ id: "valid", amount: "0" });
    const invalid = ticket({
      id: "invalid",
      travel_date: "2026-02-30",
      depart_station: "",
      amount: "-1",
      duplicate: true,
      duplicate_reason: "发票号码已存在",
    });
    const errors = validateTicketCandidates([valid, invalid]);
    assert.equal(errors.valid, undefined);
    assert.match(errors.invalid.join(" "), /乘车日期/);
    assert.doesNotMatch(errors.invalid.join(" "), /时间/);
    assert.match(errors.invalid.join(" "), /发票号码已存在/);
  });

  it("builds a time-free payload with default merge and explicit opt-out", () => {
    const tickets = [
      ticket({ id: "a", depart_time: "09:02", train_no: "G1", invoice_no: "INV-1" }),
      ticket({ id: "b", depart_time: "11:00", depart_station: "南京南", arrive_station: "芜湖" }),
    ];
    const groups = buildTicketGroups(tickets);
    const defaultPayload = buildTicketImportPayload({ token: "preview-token", tickets, groups });
    assert.equal(defaultPayload.groups[0].merge, true);
    assert.equal(defaultPayload.tickets[0].train_no, "G1");
    assert.equal(defaultPayload.tickets[0].invoice_no, "INV-1");
    assert.equal("depart_time" in defaultPayload.tickets[0], false);

    const cancelledPayload = buildTicketImportPayload({
      token: "preview-token",
      tickets,
      groups,
      mergeByGroup: { [groups[0].id]: false },
    });
    assert.equal(cancelledPayload.groups[0].merge, false);
  });

  it("removes a single ticket candidate by id and leaves the rest untouched", () => {
    const tickets = [ticket({ id: "a" }), ticket({ id: "b" }), ticket({ id: "c" })];
    assert.deepEqual(
      removeTicketCandidate(tickets, "b").map((item) => item.id),
      ["a", "c"],
    );
    assert.deepEqual(
      removeTicketCandidate(tickets, "missing").map((item) => item.id),
      ["a", "b", "c"],
    );
  });
});
