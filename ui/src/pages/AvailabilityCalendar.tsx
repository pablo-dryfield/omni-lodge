import React from "react";
import { Calendar, momentLocalizer } from "react-big-calendar";
import moment from "moment";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { styled } from "@mui/system";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";

const localizer = momentLocalizer(moment);
const PAGE_SLUG = PAGE_SLUGS.availabilityCalendar;

const bookings = [
  {
    id: 1,
    start: new Date('2023-08-15T13:29:15.524486Z'),
    end: new Date('2023-08-16T15:29:15.524486Z'),
    title: "Ola Stay (Human:)"
  },
  // Add more booking events here...
];

const AvailabilityCalendarContainer = styled("div")({
  flexGrow: 1,
  padding: "20px",
  width: "95%",
});

const AvailabilityCalendar = () => (
  <PageAccessGuard pageSlug={PAGE_SLUG}>
    <AvailabilityCalendarContainer>
      <Calendar
        onSelectEvent={(event) => {
          console.log("Selected event:", event);
        }}
        localizer={localizer}
        events={bookings}
        startAccessor="start"
        endAccessor="end"
      />
    </AvailabilityCalendarContainer>
  </PageAccessGuard>
);

export default AvailabilityCalendar;