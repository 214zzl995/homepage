import { parseString } from "cal-parser";
import { DateTime } from "luxon";
import { useTranslation } from "next-i18next";
import { useEffect } from "react";
import { RRule } from "rrule";

import Error from "../../../components/services/widget/error";
import useWidgetAPI from "../../../utils/proxy/use-widget-api";

// https://gist.github.com/jlevy/c246006675becc446360a798e2b2d781
function simpleHash(str) {
  /* eslint-disable no-plusplus, no-bitwise */
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
  /* eslint-disable no-plusplus, no-bitwise */
}

export default function Integration({ config, params, setEvents, hideErrors, timezone }) {
  const { t } = useTranslation();
  const { data: icalData, error: icalError } = useWidgetAPI(config, config.name, {
    refreshInterval: 300000, // 5 minutes
  });

  useEffect(() => {
    let parsedIcal;

    if (!icalError && icalData && !icalData.error) {
      parsedIcal = parseString(icalData.data);
      if (parsedIcal.events.length === 0) {
        icalData.error = { message: `'${config.name}': ${t("calendar.noEventsFound")}` };
      }
    }

    const startDate = DateTime.fromISO(params.start);
    const endDate = DateTime.fromISO(params.end);

    if (icalError || !parsedIcal || !startDate.isValid || !endDate.isValid) {
      return;
    }

    const eventsToAdd = {};
    const events = parsedIcal?.getEventsBetweenDates(startDate.toJSDate(), endDate.toJSDate());
    const now = timezone ? DateTime.now().setZone(timezone) : DateTime.now();

    events?.forEach((event) => {
      let title = `${event?.summary?.value}`;
      if (config?.params?.showName) {
        title = `${config.name}: ${title}`;
      }

      // 'dtend' is null for all-day events
      const { dtstart, dtend = { value: 0 } } = event;

      const eventToAdd = (date, i, type) => {
        const days = dtend.value === 0 ? 1 : (dtend.value - dtstart.value) / (1000 * 60 * 60 * 24);
        const eventDate = timezone ? DateTime.fromJSDate(date, { zone: timezone }) : DateTime.fromJSDate(date);

        for (let j = 0; j < days; j += 1) {
          // See https://github.com/gethomepage/homepage/issues/2753 uid is not stable
          // assumption is that the event is the same if the start, end and title are all the same
          const hash = simpleHash(`${dtstart?.value}${dtend?.value}${title}${i}${j}${type}}`);
          eventsToAdd[hash] = {
            title,
            date: eventDate.plus({ days: j }),
            color: config?.color ?? "zinc",
            isCompleted: eventDate < now,
            additional: event.location?.value,
            type: "ical",
          };
        }
      };

      let recurrenceOptions = event?.recurrenceRule?.origOptions;
      // RRuleSet does not have dtstart, add it manually
      if (event?.recurrenceRule && event.recurrenceRule.rrules && event.recurrenceRule.rrules()?.[0]?.origOptions) {
        recurrenceOptions = event.recurrenceRule.rrules()[0].origOptions;
        recurrenceOptions.dtstart = dtstart.value;
      }

      if (recurrenceOptions && Object.keys(recurrenceOptions).length !== 0) {
        try {
          const rule = new RRule(recurrenceOptions);
          const recurringEvents = rule.between(startDate.toJSDate(), endDate.toJSDate());

          recurringEvents.forEach((date, i) => {
            let eventDate = date;
            if (event.dtstart?.params?.tzid) {
              // date is in UTC but parsed as if it is in current timezone, so we need to adjust it
              const dateInUTC = DateTime.fromJSDate(date).setZone("UTC");
              const offset = dateInUTC.offset - DateTime.fromJSDate(date, { zone: event.dtstart.params.tzid }).offset;
              eventDate = dateInUTC.plus({ minutes: offset }).toJSDate();
            }
            eventToAdd(eventDate, i, "recurring");
          });
          return;
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("Unable to parse recurring events from iCal: %s", e);
        }
      }

      event.matchingDates.forEach((date, i) => eventToAdd(date, i, "single"));
    });

    setEvents((prevEvents) => ({ ...prevEvents, ...eventsToAdd }));
  }, [icalData, icalError, config, params, setEvents, timezone, t]);

  const error = icalError ?? icalData?.error;
  return error && !hideErrors && <Error error={{ message: `${config.type}: ${error.message ?? error}` }} />;
}
