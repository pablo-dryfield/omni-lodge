import { useEffect, useMemo, useRef } from "react";
import { Alert, Badge, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { IconAlertTriangle, IconMapRoute, IconRoute2 } from "@tabler/icons-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./PromotionRouteMapEditor.css";
import type {
  PromotionCoordinate,
  PromotionPlaybackSample,
  PromotionRouteVersion,
  PromotionSessionPlaybackResponse,
} from "../../api/promotionTracking";
import { createLeafletTooltipContent } from "./promotionMapTooltip";

type PlaybackSegment = {
  phase: "STREET" | "HOSTEL" | null;
  samples: PromotionPlaybackSample[];
};

type PlaybackGap = {
  from: PromotionPlaybackSample;
  to: PromotionPlaybackSample;
  seconds: number;
  phaseChanged: boolean;
};

type PromotionSessionPlaybackMapProps = {
  playback: PromotionSessionPlaybackResponse;
};

const STREET_COLOR = "#2563eb";
const HOSTEL_COLOR = "#7c3aed";
const ACTUAL_STREET_COLOR = "#0f766e";
const ACTUAL_HOSTEL_COLOR = "#db2777";
const GAP_COLOR = "#f59e0b";
const REVIEW_COLOR = "#dc2626";
const MAX_CONTINUOUS_GAP_SECONDS = 90;
const POOR_ACCURACY_METERS = 60;

const coordinateToLatLng = (coordinate: PromotionCoordinate): L.LatLngExpression => [
  coordinate.latitude,
  coordinate.longitude,
];

const sampleToLatLng = (sample: PromotionPlaybackSample): L.LatLngExpression => [
  sample.latitude,
  sample.longitude,
];

const isValidCoordinate = (coordinate: PromotionCoordinate | null | undefined): coordinate is PromotionCoordinate =>
  Boolean(
    coordinate &&
      Number.isFinite(coordinate.latitude) &&
      Number.isFinite(coordinate.longitude),
  );

const isValidSample = (sample: PromotionPlaybackSample) =>
  Number.isFinite(sample.latitude) &&
  Number.isFinite(sample.longitude) &&
  sample.latitude >= -90 &&
  sample.latitude <= 90 &&
  sample.longitude >= -180 &&
  sample.longitude <= 180;

const markerIcon = (label: string, className: string, small = false) =>
  L.divIcon({
    className: "",
    html: `<div class="promotion-route-marker ${small ? "promotion-route-marker--small" : ""} ${className}">${label}</div>`,
    iconSize: small ? [24, 24] : [34, 34],
    iconAnchor: small ? [12, 12] : [17, 17],
  });

const formatTime = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatDurationSeconds = (seconds: number) => {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
};

const configuredStreetLine = (route: PromotionRouteVersion): PromotionCoordinate[] => {
  const line = route.streetPolyline.length
    ? route.streetPolyline
    : route.streetCheckpoints.map((checkpoint) => checkpoint.point);
  return [route.start, ...line].filter(isValidCoordinate);
};

const configuredHostelLine = (route: PromotionRouteVersion): PromotionCoordinate[] => {
  const line = route.hostelPolyline.length
    ? route.hostelPolyline
    : route.hostelCheckpoints.map((checkpoint) => checkpoint.point);
  return [...line, route.finish].filter(isValidCoordinate);
};

const segmentSamples = (samples: PromotionPlaybackSample[]) => {
  const ordered = samples
    .filter(isValidSample)
    .slice()
    .sort((left, right) => {
      const timeDelta = new Date(left.capturedAtUtc).valueOf() - new Date(right.capturedAtUtc).valueOf();
      if (timeDelta !== 0) return timeDelta;
      return Number(left.sequence) - Number(right.sequence);
    });
  const segments: PlaybackSegment[] = [];
  const gaps: PlaybackGap[] = [];
  let current: PlaybackSegment | null = null;
  ordered.forEach((sample) => {
    const previous = current?.samples.at(-1) ?? null;
    const previousTime = previous ? new Date(previous.capturedAtUtc).valueOf() : null;
    const currentTime = new Date(sample.capturedAtUtc).valueOf();
    const gapSeconds = previousTime == null || !Number.isFinite(previousTime) || !Number.isFinite(currentTime)
      ? 0
      : Math.max(0, (currentTime - previousTime) / 1000);
    const phaseChanged = Boolean(previous && previous.phase !== sample.phase);
    const shouldBreak = !current || phaseChanged || gapSeconds > MAX_CONTINUOUS_GAP_SECONDS;
    if (previous && shouldBreak) {
      gaps.push({ from: previous, to: sample, seconds: gapSeconds, phaseChanged });
    }
    if (shouldBreak) {
      current = { phase: sample.phase, samples: [sample] };
      segments.push(current);
      return;
    }
    current?.samples.push(sample);
  });
  return { ordered, segments, gaps };
};

const PromotionSessionPlaybackMap = ({ playback }: PromotionSessionPlaybackMapProps) => {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const { ordered, segments, gaps } = useMemo(() => segmentSamples(playback.samples), [playback.samples]);
  const reviewSamples = useMemo(
    () =>
      ordered.filter((sample) =>
        sample.mockLocationSignal === true ||
        sample.horizontalAccuracyMeters > POOR_ACCURACY_METERS ||
        sample.reviewFlags.length > 0,
      ),
    [ordered],
  );

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return;
    const map = L.map(mapElementRef.current, {
      center: [50.0619, 19.9368],
      zoom: 14,
      scrollWheelZoom: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const layerGroup = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = layerGroup;
    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const layerGroup = layerGroupRef.current;
    const map = mapRef.current;
    if (!layerGroup || !map) return;
    layerGroup.clearLayers();
    const route = playback.routeVersion;
    const boundsCoordinates: PromotionCoordinate[] = [];

    const streetLine = configuredStreetLine(route);
    if (streetLine.length > 1) {
      L.polyline(streetLine.map(coordinateToLatLng), {
        color: STREET_COLOR,
        weight: 4,
        opacity: 0.35,
        dashArray: "8 8",
      })
        .bindTooltip(createLeafletTooltipContent("Configured street route"))
        .addTo(layerGroup);
      boundsCoordinates.push(...streetLine);
    }

    const hostelLine = configuredHostelLine(route);
    if (hostelLine.length > 1) {
      L.polyline(hostelLine.map(coordinateToLatLng), {
        color: HOSTEL_COLOR,
        weight: 4,
        opacity: 0.35,
        dashArray: "8 8",
      })
        .bindTooltip(createLeafletTooltipContent("Configured hostel route"))
        .addTo(layerGroup);
      boundsCoordinates.push(...hostelLine);
    }

    if (isValidCoordinate(route.start)) {
      L.circle(coordinateToLatLng(route.start), {
        radius: route.start.radiusMeters,
        color: "#16a34a",
        fillColor: "#16a34a",
        fillOpacity: 0.06,
        weight: 1,
      }).addTo(layerGroup);
      L.marker(coordinateToLatLng(route.start), {
        icon: markerIcon("S", "promotion-route-marker--start"),
        title: "Starting point",
      })
        .bindTooltip(createLeafletTooltipContent(route.start.label), { direction: "top" })
        .addTo(layerGroup);
      boundsCoordinates.push(route.start);
    }

    route.streetCheckpoints.forEach((checkpoint, index) => {
      L.circle(coordinateToLatLng(checkpoint.point), {
        radius: checkpoint.point.radiusMeters,
        color: STREET_COLOR,
        fillColor: STREET_COLOR,
        fillOpacity: 0.05,
        weight: 1,
      }).addTo(layerGroup);
      L.marker(coordinateToLatLng(checkpoint.point), {
        icon: markerIcon(`C${index + 1}`, "promotion-route-marker--checkpoint"),
        title: checkpoint.label,
      })
        .bindTooltip(createLeafletTooltipContent(`${index + 1}. ${checkpoint.label}`), { direction: "top" })
        .addTo(layerGroup);
      boundsCoordinates.push(checkpoint.point);
    });

    route.hostelCheckpoints.forEach((checkpoint, index) => {
      L.marker(coordinateToLatLng(checkpoint.point), {
        icon: markerIcon(`H${index + 1}`, "promotion-route-marker--hostel-waypoint"),
        title: checkpoint.label,
      })
        .bindTooltip(createLeafletTooltipContent(`${index + 1}. ${checkpoint.label}`), { direction: "top" })
        .addTo(layerGroup);
      boundsCoordinates.push(checkpoint.point);
    });

    if (isValidCoordinate(route.finish)) {
      L.circle(coordinateToLatLng(route.finish), {
        radius: route.finish.radiusMeters,
        color: HOSTEL_COLOR,
        fillColor: HOSTEL_COLOR,
        fillOpacity: 0.06,
        weight: 1,
      }).addTo(layerGroup);
      L.marker(coordinateToLatLng(route.finish), {
        icon: markerIcon("F", "promotion-route-marker--hostel-waypoint"),
        title: "Finish point",
      })
        .bindTooltip(createLeafletTooltipContent(route.finish.label), { direction: "top" })
        .addTo(layerGroup);
      boundsCoordinates.push(route.finish);
    }

    segments.forEach((segment) => {
      if (segment.samples.length < 2) return;
      L.polyline(segment.samples.map(sampleToLatLng), {
        color: segment.phase === "HOSTEL" ? ACTUAL_HOSTEL_COLOR : ACTUAL_STREET_COLOR,
        weight: 6,
        opacity: 0.88,
      })
        .bindTooltip(
          createLeafletTooltipContent(segment.phase === "HOSTEL" ? "Actual hostel path" : "Actual street path"),
        )
        .addTo(layerGroup);
      segment.samples.forEach((sample) => boundsCoordinates.push(sample));
    });

    gaps.forEach((gap) => {
      L.polyline([sampleToLatLng(gap.from), sampleToLatLng(gap.to)], {
        color: GAP_COLOR,
        weight: 4,
        opacity: 0.85,
        dashArray: "4 8",
      })
        .bindTooltip(
          createLeafletTooltipContent(
            gap.phaseChanged
              ? "Phase transition / line intentionally split"
              : `GPS gap: ${formatDurationSeconds(gap.seconds)} without samples`,
          ),
        )
        .addTo(layerGroup);
    });

    reviewSamples.forEach((sample) => {
      L.circleMarker(sampleToLatLng(sample), {
        radius: 6,
        color: REVIEW_COLOR,
        fillColor: sample.mockLocationSignal ? REVIEW_COLOR : GAP_COLOR,
        fillOpacity: 0.85,
        weight: 2,
      })
        .bindTooltip(
          createLeafletTooltipContent(
            [
              `Review sample: ${formatTime(sample.capturedAtUtc)}`,
              `accuracy ±${Math.round(sample.horizontalAccuracyMeters)}m`,
              sample.mockLocationSignal ? "mock-location signal" : null,
              sample.reviewFlags.length ? sample.reviewFlags.join(", ") : null,
            ].filter(Boolean).join(" · "),
          ),
        )
        .addTo(layerGroup);
      boundsCoordinates.push(sample);
    });

    if (ordered.length > 0) {
      const first = ordered[0];
      const last = ordered[ordered.length - 1];
      L.marker(sampleToLatLng(first), {
        icon: markerIcon("1", "promotion-route-marker--small promotion-route-marker--street-waypoint", true),
        title: "First sample",
      })
        .bindTooltip(createLeafletTooltipContent(`First sample · ${formatTime(first.capturedAtUtc)}`), { direction: "top" })
        .addTo(layerGroup);
      L.marker(sampleToLatLng(last), {
        icon: markerIcon("L", "promotion-route-marker--small promotion-route-marker--hostel-waypoint", true),
        title: "Last sample",
      })
        .bindTooltip(createLeafletTooltipContent(`Last sample · ${formatTime(last.capturedAtUtc)}`), { direction: "top" })
        .addTo(layerGroup);
      boundsCoordinates.push(first, last);
    }

    if (boundsCoordinates.length > 0) {
      map.fitBounds(L.latLngBounds(boundsCoordinates.map(coordinateToLatLng)).pad(0.16), { maxZoom: 18 });
    }
  }, [gaps, ordered, playback.routeVersion, reviewSamples, segments]);

  return (
    <Paper withBorder radius="lg" p="md" bg="#F8FAFC">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Group gap="xs">
              <IconMapRoute size={22} />
              <Title order={4}>Actual route playback</Title>
            </Group>
            <Text size="sm" c="dimmed">
              Solid lines show sampled movement. Dashed orange lines mark GPS gaps or phase splits, not assumed walking paths.
            </Text>
          </Stack>
          <Group gap="xs">
            <Badge color="teal" variant="light">Street actual</Badge>
            <Badge color="grape" variant="light">Hostel actual</Badge>
            <Badge color="orange" variant="light">Gap/review</Badge>
          </Group>
        </Group>

        {ordered.length === 0 ? (
          <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="No samples recorded">
            This session has no uploaded GPS samples yet, so only the configured route can be shown.
          </Alert>
        ) : (
          <Group gap="xs">
            <Badge variant="light" color="blue">{ordered.length} sample(s)</Badge>
            <Badge variant="light" color={gaps.length ? "orange" : "green"}>{gaps.length} gap(s)</Badge>
            <Badge variant="light" color={reviewSamples.length ? "red" : "green"}>{reviewSamples.length} review sample(s)</Badge>
          </Group>
        )}

        <div className="promotion-route-map-shell promotion-playback-map-shell">
          <div ref={mapElementRef} className="promotion-route-map promotion-playback-map" aria-label="Promotion session playback map" />
          <div className="promotion-route-map-hint">
            <IconRoute2 size={14} /> Faint dashed lines are configured routes. Solid lines are actual uploaded GPS samples.
          </div>
        </div>
      </Stack>
    </Paper>
  );
};

export default PromotionSessionPlaybackMap;
