const PDF_MIME_TYPES = new Set(["application/pdf", "application/x-pdf"]);

const asText = (value) => String(value ?? "").trim();

const isValidDate = (value) => {
  const match = asText(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const travelDay = (ticket) => {
  if (!isValidDate(ticket?.travel_date)) return null;
  const [year, month, day] = ticket.travel_date.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
};

const hasValidAmount = (ticket) => {
  const amount = Number(ticket?.amount);
  return (
    ticket?.amount !== "" &&
    ticket?.amount !== null &&
    ticket?.amount !== undefined &&
    Number.isFinite(amount) &&
    amount >= 0
  );
};

export const normalizeStationName = (value) =>
  asText(value)
    .replace(/\s+/g, "")
    .replace(/站$/u, "")
    .toLocaleLowerCase("zh-CN");

export const isTicketPdfFile = (file) => {
  if (!file) return false;
  const mime = asText(file.type).toLowerCase();
  return PDF_MIME_TYPES.has(mime) || /\.pdf$/i.test(asText(file.name));
};

export const getTicketFileKey = (file) =>
  [asText(file?.name).toLowerCase(), Number(file?.size || 0), Number(file?.lastModified || 0)].join(":");

export const mergeTicketPdfFiles = (currentFiles, incomingFiles) => {
  const files = Array.from(currentFiles || []);
  const keys = new Set(files.map(getTicketFileKey));
  const rejected = [];
  const duplicates = [];

  Array.from(incomingFiles || []).forEach((file) => {
    if (!isTicketPdfFile(file)) {
      rejected.push(file);
      return;
    }
    const key = getTicketFileKey(file);
    if (keys.has(key)) {
      duplicates.push(file);
      return;
    }
    keys.add(key);
    files.push(file);
  });

  return { files, rejected, duplicates };
};

export const normalizeTicketCandidate = (ticket = {}, index = 0) => {
  const { depart_time: _ignoredDepartTime, ...candidate } = ticket;
  return {
    ...candidate,
    id: asText(ticket.id) || `ticket-${index + 1}`,
    file_name: asText(ticket.file_name),
    travel_date: asText(ticket.travel_date),
    depart_station: asText(ticket.depart_station),
    arrive_station: asText(ticket.arrive_station),
    train_no: asText(ticket.train_no),
    seat_class: asText(ticket.seat_class),
    seat_no: asText(ticket.seat_no),
    amount: ticket.amount === null || ticket.amount === undefined ? "" : asText(ticket.amount),
    invoice_no: asText(ticket.invoice_no),
    invoice_date: asText(ticket.invoice_date),
    parse_warnings: Array.isArray(ticket.parse_warnings) ? ticket.parse_warnings.map(asText).filter(Boolean) : [],
    duplicate: Boolean(ticket.duplicate),
    duplicate_reason: asText(ticket.duplicate_reason),
  };
};

export const normalizeTicketCandidates = (tickets) =>
  Array.from(tickets || []).map(normalizeTicketCandidate);

export const moveTicketCandidate = (tickets, fromIndex, toIndex) => {
  const next = Array.from(tickets || []);
  if (fromIndex < 0 || fromIndex >= next.length || toIndex < 0 || toIndex >= next.length || fromIndex === toIndex) {
    return next;
  }
  const [ticket] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, ticket);
  return next;
};

export const removeTicketCandidate = (tickets, ticketId) => {
  const key = String(ticketId);
  return Array.from(tickets || []).filter((ticket) => String(ticket?.id) !== key);
};

export const getTicketConnection = (previous, next) => {
  if (previous?.duplicate || next?.duplicate || !hasValidAmount(previous) || !hasValidAmount(next)) return null;
  const previousArrival = normalizeStationName(previous?.arrive_station);
  const nextDeparture = normalizeStationName(next?.depart_station);
  if (
    !normalizeStationName(previous?.depart_station) ||
    !previousArrival ||
    !nextDeparture ||
    !normalizeStationName(next?.arrive_station) ||
    previousArrival !== nextDeparture
  ) {
    return null;
  }

  const previousDay = travelDay(previous);
  const nextDay = travelDay(next);
  if (previousDay === null || nextDay === null) return null;
  const dayGap = nextDay - previousDay;
  if (dayGap !== 0 && dayGap !== 1) return null;
  return { crossDay: dayGap === 1, dayGap };
};

const orderedComponentIndexes = (component, outgoing, incoming) => {
  const originalOrder = [...component].sort((left, right) => left - right);
  if (component.length <= 1) return originalOrder;

  const componentSet = new Set(component);
  const successors = new Map();
  const predecessors = new Map();
  component.forEach((index) => {
    successors.set(index, [...outgoing[index]].filter((candidate) => componentSet.has(candidate)));
    predecessors.set(index, [...incoming[index]].filter((candidate) => componentSet.has(candidate)));
  });

  if (
    component.some(
      (index) => successors.get(index).length > 1 || predecessors.get(index).length > 1,
    )
  ) {
    return originalOrder;
  }

  const starts = component.filter((index) => predecessors.get(index).length === 0);
  const ends = component.filter((index) => successors.get(index).length === 0);
  if (starts.length !== 1 || ends.length !== 1) return originalOrder;

  const ordered = [];
  const visited = new Set();
  let current = starts[0];
  while (current !== undefined && !visited.has(current)) {
    ordered.push(current);
    visited.add(current);
    current = successors.get(current)[0];
  }

  return ordered.length === component.length ? ordered : originalOrder;
};

export const sortTicketCandidates = (tickets) => {
  const candidates = Array.from(tickets || []);
  if (candidates.length <= 1) return candidates;

  const outgoing = candidates.map(() => new Set());
  const incoming = candidates.map(() => new Set());
  const neighbors = candidates.map(() => new Set());
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < candidates.length; rightIndex += 1) {
      if (leftIndex === rightIndex || !getTicketConnection(candidates[leftIndex], candidates[rightIndex])) continue;
      outgoing[leftIndex].add(rightIndex);
      incoming[rightIndex].add(leftIndex);
      neighbors[leftIndex].add(rightIndex);
      neighbors[rightIndex].add(leftIndex);
    }
  }

  const visited = new Set();
  const components = [];
  for (let startIndex = 0; startIndex < candidates.length; startIndex += 1) {
    if (visited.has(startIndex)) continue;
    const component = [];
    const pending = [startIndex];
    visited.add(startIndex);
    while (pending.length > 0) {
      const index = pending.pop();
      component.push(index);
      neighbors[index].forEach((neighbor) => {
        if (visited.has(neighbor)) return;
        visited.add(neighbor);
        pending.push(neighbor);
      });
    }

    const originalIndex = Math.min(...component);
    const validDays = component.map((index) => travelDay(candidates[index])).filter((day) => day !== null);
    components.push({
      originalIndex,
      earliestDay: validDays.length > 0 ? Math.min(...validDays) : Number.POSITIVE_INFINITY,
      indexes: orderedComponentIndexes(component, outgoing, incoming),
    });
  }

  components.sort((left, right) => {
    if (left.earliestDay !== right.earliestDay) return left.earliestDay < right.earliestDay ? -1 : 1;
    return left.originalIndex - right.originalIndex;
  });
  return components.flatMap((component) => component.indexes.map((index) => candidates[index]));
};

const groupPath = (tickets) => {
  if (tickets.length === 0) return [];
  return [tickets[0].depart_station, ...tickets.map((ticket) => ticket.arrive_station)].filter(Boolean);
};

const groupAmount = (tickets) =>
  tickets
    .reduce((sum, ticket) => {
      const value = Number(ticket.amount);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0)
    .toFixed(2);

const makeTicketGroup = (tickets, { routeLoop = false, loopStation = "" } = {}) => {
  const ids = tickets.map((ticket) => String(ticket.id));
  const path = groupPath(tickets);
  const roundTrip =
    tickets.length > 1 &&
    normalizeStationName(tickets[0].depart_station) === normalizeStationName(tickets.at(-1).arrive_station);
  const crossDay = tickets.some((ticket, index) => index > 0 && ticket.travel_date !== tickets[index - 1].travel_date);
  return {
    id: `ticket-group:${ids.join("|")}`,
    ticket_ids: ids,
    tickets,
    path,
    total_amount: groupAmount(tickets),
    cross_day: crossDay,
    round_trip: roundTrip,
    route_loop: routeLoop,
    suggested_merge: tickets.length > 1 && !roundTrip && !routeLoop,
    warning:
      routeLoop
        ? `检测到返回已访问站点${loopStation ? `“${loopStation}”` : ""}，已将该车票作为返程或回环行程单独保留。`
        : tickets.length <= 1
          ? ""
          : roundTrip
            ? "检测到往返或路线回环，已保持为独立行程。"
            : crossDay
              ? "站点连续且乘车日期为次日，已默认合并为中转行程；如非中转可取消合并。"
              : "站点连续且乘车日期相同，已默认合并为中转行程；如非中转可取消合并。",
  };
};

export const buildTicketGroups = (tickets, { breakAfterIds = [] } = {}) => {
  const candidates = Array.from(tickets || []).map(normalizeTicketCandidate);
  if (candidates.length === 0) return [];
  const breaks = new Set(Array.from(breakAfterIds || []).map(String));
  const groups = [];
  let current = [candidates[0]];

  const flushCurrent = () => {
    if (current.length > 0) groups.push(makeTicketGroup(current));
    current = [];
  };

  for (let index = 1; index < candidates.length; index += 1) {
    const ticket = candidates[index];
    if (current.length === 0) {
      current = [ticket];
      continue;
    }

    const previous = current.at(-1);
    const connected = getTicketConnection(previous, ticket);
    if (!connected || breaks.has(String(previous.id))) {
      flushCurrent();
      current = [ticket];
      continue;
    }

    const visitedStations = new Set(
      [current[0].depart_station, ...current.map((item) => item.arrive_station)].map(normalizeStationName).filter(Boolean),
    );
    const nextArrival = normalizeStationName(ticket.arrive_station);
    if (nextArrival && visitedStations.has(nextArrival)) {
      flushCurrent();
      groups.push(makeTicketGroup([ticket], { routeLoop: true, loopStation: ticket.arrive_station }));
      continue;
    }

    current.push(ticket);
  }
  flushCurrent();
  return groups;
};

export const validateTicketCandidates = (tickets) => {
  const errors = {};
  Array.from(tickets || []).forEach((ticket, index) => {
    const id = String(ticket?.id || `ticket-${index + 1}`);
    const ticketErrors = [];
    if (!isValidDate(ticket?.travel_date)) ticketErrors.push("请填写有效乘车日期");
    if (!asText(ticket?.depart_station)) ticketErrors.push("请填写出发站");
    if (!asText(ticket?.arrive_station)) ticketErrors.push("请填写到达站");
    if (!hasValidAmount(ticket)) {
      ticketErrors.push("请填写有效票价");
    }
    if (ticket?.duplicate) ticketErrors.push(ticket.duplicate_reason || "该车票疑似重复，不能再次导入");
    if (ticketErrors.length > 0) errors[id] = ticketErrors;
  });
  return errors;
};

const editableTicketPayload = (ticket) => ({
  id: ticket.id,
  travel_date: asText(ticket.travel_date) || null,
  depart_station: asText(ticket.depart_station) || null,
  arrive_station: asText(ticket.arrive_station) || null,
  train_no: asText(ticket.train_no) || null,
  seat_class: asText(ticket.seat_class) || null,
  seat_no: asText(ticket.seat_no) || null,
  amount: ticket.amount === "" || ticket.amount === null || ticket.amount === undefined ? null : String(ticket.amount),
  invoice_no: asText(ticket.invoice_no) || null,
  invoice_date: asText(ticket.invoice_date) || null,
});

export const shouldMergeTicketGroup = (group, mergeByGroup = {}) => {
  if (!group?.suggested_merge || group.round_trip || group.route_loop) return false;
  if (Object.prototype.hasOwnProperty.call(mergeByGroup, group.id)) return Boolean(mergeByGroup[group.id]);
  return true;
};

export const buildTicketImportPayload = ({ token, tickets, groups, mergeByGroup = {} }) => ({
  token,
  tickets: Array.from(tickets || []).map(editableTicketPayload),
  groups: Array.from(groups || []).map((group) => ({
    ticket_ids: group.ticket_ids.map(String),
    merge: shouldMergeTicketGroup(group, mergeByGroup),
  })),
});
