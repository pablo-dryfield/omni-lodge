import { useCallback, useEffect, useMemo, useRef } from "react";
import { Alert, Badge, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { IconAlertTriangle, IconMapPin, IconRoute, IconTargetArrow } from "@tabler/icons-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./PromotionRouteMapEditor.css";
import type { PromotionCoordinate } from "../../api/promotionTracking";
import { createLeafletTooltipContent } from "./promotionMapTooltip";

export type PromotionRouteMapTool =
  | "pan"
  | "set-start"
  | "add-street-checkpoint"
  | "add-street-waypoint"
  | `set-hostel-finish:${string}`
  | `add-hostel-waypoint:${string}`;

export type PromotionMapPoint = PromotionCoordinate & {
  label?: string;
  radiusMeters?: number;
};

export type PromotionMapCheckpoint = PromotionCoordinate & {
  label: string;
  radiusMeters: number;
  instruction?: string;
  requiredDwellSeconds?: number;
};

export type PromotionMapHostel = {
  hostelName: string;
  finish: PromotionMapPoint | null;
  polyline: PromotionCoordinate[];
};

type PromotionRouteMapEditorProps = {
  start: PromotionMapPoint | null;
  streetPolyline: PromotionCoordinate[];
  streetCheckpoints: PromotionMapCheckpoint[];
  hostels: PromotionMapHostel[];
  activeTool: PromotionRouteMapTool;
  onActiveToolChange: (tool: PromotionRouteMapTool) => void;
  onStartMove: (coordinate: PromotionCoordinate) => void;
  onStreetCheckpointAdd: (coordinate: PromotionCoordinate) => void;
  onStreetCheckpointMove: (index: number, coordinate: PromotionCoordinate) => void;
  onStreetPolylineAdd: (coordinate: PromotionCoordinate) => void;
  onStreetPolylineMove: (index: number, coordinate: PromotionCoordinate) => void;
  onStreetPolylineClear: () => void;
  onHostelFinishMove: (hostelName: string, coordinate: PromotionCoordinate) => void;
  onHostelPolylineAdd: (hostelName: string, coordinate: PromotionCoordinate) => void;
  onHostelPolylineMove: (hostelName: string, index: number, coordinate: PromotionCoordinate) => void;
  onHostelPolylineClear: (hostelName: string) => void;
};

const KRAKOW_CENTER: [number, number] = [50.0619, 19.9368];
const KRAKOW_ROUTE_BOUNDS = L.latLngBounds([49.92, 19.68], [50.22, 20.18]);
const STREET_COLOR = "#2563eb";
const CHECKPOINT_LINK_COLOR = "#0f766e";
const HOSTEL_COLORS: Record<string, string> = {
  "Atlantis Hostel": "#7c3aed",
  "Bubble Hostel": "#db2777",
  "Draggo House": "#ea580c",
};

const coordinateToLatLng = (coordinate: PromotionCoordinate): L.LatLngExpression => [
  coordinate.latitude,
  coordinate.longitude,
];

const latLngToCoordinate = (latLng: L.LatLng): PromotionCoordinate => ({
  latitude: latLng.lat,
  longitude: latLng.lng,
});

const isValidCoordinate = (coordinate: PromotionCoordinate | null | undefined): coordinate is PromotionCoordinate =>
  Boolean(
    coordinate &&
      Number.isFinite(coordinate.latitude) &&
      Number.isFinite(coordinate.longitude),
  );

const normalizeHostelClass = (hostelName: string) => {
  const normalized = hostelName.toLowerCase();
  if (normalized.includes("atlantis")) return "promotion-route-marker--hostel-atlantis";
  if (normalized.includes("bubble")) return "promotion-route-marker--hostel-bubble";
  if (normalized.includes("draggo")) return "promotion-route-marker--hostel-draggo";
  return "promotion-route-marker--hostel-waypoint";
};

const markerIcon = (label: string, className: string, small = false) =>
  L.divIcon({
    className: "",
    html: `<div class="promotion-route-marker ${small ? "promotion-route-marker--small" : ""} ${className}">${label}</div>`,
    iconSize: small ? [24, 24] : [34, 34],
    iconAnchor: small ? [12, 12] : [17, 17],
  });

const toolLabel = (tool: PromotionRouteMapTool) => {
  if (tool === "pan") return "Pan / review";
  if (tool === "set-start") return "Click to set the starting point";
  if (tool === "add-street-checkpoint") return "Click to add the next ordered street checkpoint";
  if (tool === "add-street-waypoint") return "Click to add a street-route waypoint";
  if (tool.startsWith("set-hostel-finish:")) {
    return `Click to set ${tool.replace("set-hostel-finish:", "")} finish`;
  }
  if (tool.startsWith("add-hostel-waypoint:")) {
    return `Click to add ${tool.replace("add-hostel-waypoint:", "")} route waypoint`;
  }
  return "Pan / review";
};

const toolColor = (tool: PromotionRouteMapTool) => (tool === "pan" ? "gray" : "blue");

const collectBoundsCoordinates = (
  start: PromotionMapPoint | null,
  streetPolyline: PromotionCoordinate[],
  streetCheckpoints: PromotionMapCheckpoint[],
  hostels: PromotionMapHostel[],
) => [
  ...(isValidCoordinate(start) ? [start] : []),
  ...streetPolyline.filter(isValidCoordinate),
  ...streetCheckpoints.filter(isValidCoordinate),
  ...hostels.flatMap((hostel) => [
    ...(isValidCoordinate(hostel.finish) ? [hostel.finish] : []),
    ...hostel.polyline.filter(isValidCoordinate),
  ]),
];

const isInKrakowRouteArea = (coordinate: PromotionCoordinate) =>
  KRAKOW_ROUTE_BOUNDS.contains(coordinateToLatLng(coordinate));

const isProbablySwappedKrakowCoordinate = (coordinate: PromotionCoordinate) =>
  coordinate.latitude >= 19.68 &&
  coordinate.latitude <= 20.18 &&
  coordinate.longitude >= 49.92 &&
  coordinate.longitude <= 50.22;

const addCircle = (layerGroup: L.LayerGroup, coordinate: PromotionCoordinate, radiusMeters: number | undefined, color: string) => {
  if (!Number.isFinite(radiusMeters) || Number(radiusMeters) <= 0) return;
  L.circle(coordinateToLatLng(coordinate), {
    radius: Number(radiusMeters),
    color,
    fillColor: color,
    fillOpacity: 0.08,
    weight: 1,
  }).addTo(layerGroup);
};

const PromotionRouteMapEditor = ({
  start,
  streetPolyline,
  streetCheckpoints,
  hostels,
  activeTool,
  onActiveToolChange,
  onStartMove,
  onStreetCheckpointAdd,
  onStreetCheckpointMove,
  onStreetPolylineAdd,
  onStreetPolylineMove,
  onStreetPolylineClear,
  onHostelFinishMove,
  onHostelPolylineAdd,
  onHostelPolylineMove,
  onHostelPolylineClear,
}: PromotionRouteMapEditorProps) => {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const didAutoFitRef = useRef(false);
  const latestPropsRef = useRef({
    activeTool,
    onStartMove,
    onStreetCheckpointAdd,
    onStreetPolylineAdd,
    onHostelFinishMove,
    onHostelPolylineAdd,
  });

  latestPropsRef.current = {
    activeTool,
    onStartMove,
    onStreetCheckpointAdd,
    onStreetPolylineAdd,
    onHostelFinishMove,
    onHostelPolylineAdd,
  };

  const boundsCoordinates = useMemo(
    () => collectBoundsCoordinates(start, streetPolyline, streetCheckpoints, hostels),
    [hostels, start, streetCheckpoints, streetPolyline],
  );
  const routeAreaCoordinates = useMemo(
    () => boundsCoordinates.filter(isInKrakowRouteArea),
    [boundsCoordinates],
  );
  const outOfAreaCoordinates = boundsCoordinates.length - routeAreaCoordinates.length;
  const probablySwappedCoordinates = useMemo(
    () => boundsCoordinates.filter(isProbablySwappedKrakowCoordinate).length,
    [boundsCoordinates],
  );

  const centerKrakow = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setView(KRAKOW_CENTER, 14);
  }, []);

  const fitMapToRoute = useCallback((includeOutOfArea = false) => {
    const map = mapRef.current;
    if (!map) return;
    const coordinatesToFit = includeOutOfArea ? boundsCoordinates : routeAreaCoordinates;
    if (coordinatesToFit.length === 0) {
      centerKrakow();
      return;
    }
    const bounds = L.latLngBounds(coordinatesToFit.map(coordinateToLatLng));
    map.fitBounds(bounds.pad(0.18), { maxZoom: 18 });
  }, [boundsCoordinates, centerKrakow, routeAreaCoordinates]);

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return;

    const map = L.map(mapElementRef.current, {
      center: KRAKOW_CENTER,
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

    map.on("click", (event: L.LeafletMouseEvent) => {
      const props = latestPropsRef.current;
      const coordinate = latLngToCoordinate(event.latlng);
      if (props.activeTool === "set-start") {
        props.onStartMove(coordinate);
        return;
      }
      if (props.activeTool === "add-street-checkpoint") {
        props.onStreetCheckpointAdd(coordinate);
        return;
      }
      if (props.activeTool === "add-street-waypoint") {
        props.onStreetPolylineAdd(coordinate);
        return;
      }
      if (props.activeTool.startsWith("set-hostel-finish:")) {
        props.onHostelFinishMove(props.activeTool.replace("set-hostel-finish:", ""), coordinate);
        return;
      }
      if (props.activeTool.startsWith("add-hostel-waypoint:")) {
        props.onHostelPolylineAdd(props.activeTool.replace("add-hostel-waypoint:", ""), coordinate);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const layerGroup = layerGroupRef.current;
    if (!layerGroup) return;
    layerGroup.clearLayers();

    if (isValidCoordinate(start)) {
      addCircle(layerGroup, start, start.radiusMeters, "#16a34a");
      L.marker(coordinateToLatLng(start), {
        draggable: true,
        icon: markerIcon("S", "promotion-route-marker--start"),
        title: "Starting point",
      })
        .on("dragend", (event) => onStartMove(latLngToCoordinate((event.target as L.Marker).getLatLng())))
        .bindTooltip(createLeafletTooltipContent(start.label ?? "Start"), { direction: "top" })
        .addTo(layerGroup);
    }

    const streetRoute = streetPolyline.filter(isValidCoordinate);
    if (streetRoute.length > 1) {
      L.polyline(streetRoute.map(coordinateToLatLng), {
        color: STREET_COLOR,
        weight: 5,
        opacity: 0.88,
      })
        .bindTooltip(createLeafletTooltipContent("Street route line"))
        .addTo(layerGroup);
    }

    streetRoute.forEach((coordinate, index) => {
      L.marker(coordinateToLatLng(coordinate), {
        draggable: true,
        icon: markerIcon(String(index + 1), "promotion-route-marker--street-waypoint", true),
        title: `Street route waypoint ${index + 1}`,
      })
        .on("dragend", (event) => onStreetPolylineMove(index, latLngToCoordinate((event.target as L.Marker).getLatLng())))
        .bindTooltip(createLeafletTooltipContent(`Street route waypoint ${index + 1}`), { direction: "top" })
        .addTo(layerGroup);
    });

    const checkpointLink = [
      ...(isValidCoordinate(start) ? [start] : []),
      ...streetCheckpoints.filter(isValidCoordinate),
    ];
    if (checkpointLink.length > 1) {
      L.polyline(checkpointLink.map(coordinateToLatLng), {
        color: CHECKPOINT_LINK_COLOR,
        weight: 3,
        opacity: 0.8,
        dashArray: "7 7",
      })
        .bindTooltip(createLeafletTooltipContent("Ordered checkpoint link"))
        .addTo(layerGroup);
    }

    streetCheckpoints.forEach((checkpoint, index) => {
      addCircle(layerGroup, checkpoint, checkpoint.radiusMeters, STREET_COLOR);
      L.marker(coordinateToLatLng(checkpoint), {
        draggable: true,
        icon: markerIcon(`C${index + 1}`, "promotion-route-marker--checkpoint"),
        title: checkpoint.label,
      })
        .on("dragend", (event) => onStreetCheckpointMove(index, latLngToCoordinate((event.target as L.Marker).getLatLng())))
        .bindTooltip(createLeafletTooltipContent(`${index + 1}. ${checkpoint.label}`), { direction: "top" })
        .addTo(layerGroup);
    });

    hostels.forEach((hostel) => {
      const color = HOSTEL_COLORS[hostel.hostelName] ?? "#475569";
      const hostelRoute = hostel.polyline.filter(isValidCoordinate);
      if (hostelRoute.length > 1) {
        L.polyline(hostelRoute.map(coordinateToLatLng), {
          color,
          weight: 4,
          opacity: 0.82,
        })
          .bindTooltip(createLeafletTooltipContent(`${hostel.hostelName} route`))
          .addTo(layerGroup);
      }
      hostelRoute.forEach((coordinate, index) => {
        L.marker(coordinateToLatLng(coordinate), {
          draggable: true,
          icon: markerIcon(String(index + 1), "promotion-route-marker--hostel-waypoint", true),
          title: `${hostel.hostelName} waypoint ${index + 1}`,
        })
          .on("dragend", (event) =>
            onHostelPolylineMove(hostel.hostelName, index, latLngToCoordinate((event.target as L.Marker).getLatLng())),
          )
          .bindTooltip(createLeafletTooltipContent(`${hostel.hostelName} waypoint ${index + 1}`), { direction: "top" })
          .addTo(layerGroup);
      });

      if (isValidCoordinate(hostel.finish)) {
        addCircle(layerGroup, hostel.finish, hostel.finish.radiusMeters, color);
        L.marker(coordinateToLatLng(hostel.finish), {
          draggable: true,
          icon: markerIcon("F", normalizeHostelClass(hostel.hostelName)),
          title: `${hostel.hostelName} finish`,
        })
          .on("dragend", (event) =>
            onHostelFinishMove(hostel.hostelName, latLngToCoordinate((event.target as L.Marker).getLatLng())),
          )
          .bindTooltip(createLeafletTooltipContent(`${hostel.hostelName} finish`), { direction: "top" })
          .addTo(layerGroup);
      }
    });

    if (!didAutoFitRef.current && routeAreaCoordinates.length > 0) {
      didAutoFitRef.current = true;
      window.setTimeout(() => fitMapToRoute(false), 0);
    }
  }, [
    boundsCoordinates,
    fitMapToRoute,
    hostels,
    onHostelFinishMove,
    onHostelPolylineMove,
    onStartMove,
    onStreetCheckpointMove,
    onStreetPolylineMove,
    start,
    streetCheckpoints,
    streetPolyline,
    routeAreaCoordinates,
  ]);

  return (
    <Paper withBorder radius="lg" p="md" bg="#F8FAFC">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Group gap="xs">
              <IconRoute size={20} />
              <Title order={4}>Map route editor</Title>
            </Group>
            <Text size="sm" c="dimmed">
              Select a tool, click the map to place points, then drag markers to fine-tune exact locations.
            </Text>
          </Stack>
          <Badge color={toolColor(activeTool)} variant="light" size="lg">
            {toolLabel(activeTool)}
          </Badge>
        </Group>

        <Group gap="xs">
          <Button
            size="xs"
            variant={activeTool === "pan" ? "filled" : "light"}
            color="gray"
            onClick={() => onActiveToolChange("pan")}
          >
            Pan
          </Button>
          <Button
            size="xs"
            leftSection={<IconTargetArrow size={14} />}
            variant={activeTool === "set-start" ? "filled" : "light"}
            color="green"
            onClick={() => onActiveToolChange("set-start")}
          >
            Set start
          </Button>
          <Button
            size="xs"
            leftSection={<IconMapPin size={14} />}
            variant={activeTool === "add-street-checkpoint" ? "filled" : "light"}
            onClick={() => onActiveToolChange("add-street-checkpoint")}
          >
            Add checkpoint
          </Button>
          <Button
            size="xs"
            variant={activeTool === "add-street-waypoint" ? "filled" : "light"}
            color="teal"
            onClick={() => onActiveToolChange("add-street-waypoint")}
          >
            Add street line point
          </Button>
          <Button size="xs" variant="subtle" color="gray" onClick={onStreetPolylineClear}>
            Clear street line
          </Button>
          <Button size="xs" variant="subtle" color="gray" onClick={centerKrakow}>
            Center Krakow
          </Button>
          <Button size="xs" variant="subtle" color="gray" onClick={() => fitMapToRoute(false)}>
            Fit Krakow points
          </Button>
          {outOfAreaCoordinates > 0 && (
            <Button size="xs" variant="subtle" color="orange" onClick={() => fitMapToRoute(true)}>
              Fit all saved points
            </Button>
          )}
        </Group>

        {outOfAreaCoordinates > 0 && (
          <Alert color="orange" icon={<IconAlertTriangle size={18} />} title="Some saved points are outside the Krakow route area">
            {probablySwappedCoordinates > 0
              ? "At least one point looks like latitude/longitude may be swapped. Use Center Krakow, then click or drag the marker to set the correct location."
              : "The editor will stay centered on Krakow by default. Use Fit all saved points only if you intentionally need to inspect the out-of-area coordinates."}
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="xs">
          {hostels.map((hostel) => {
            const finishTool = `set-hostel-finish:${hostel.hostelName}` as PromotionRouteMapTool;
            const waypointTool = `add-hostel-waypoint:${hostel.hostelName}` as PromotionRouteMapTool;
            return (
              <Paper key={hostel.hostelName} withBorder radius="md" p="xs">
                <Stack gap={6}>
                  <Group justify="space-between" gap="xs">
                    <Text size="sm" fw={800}>{hostel.hostelName}</Text>
                    <Badge size="xs" color={hostel.finish ? "green" : "yellow"} variant="light">
                      {hostel.finish ? "finish set" : "needs finish"}
                    </Badge>
                  </Group>
                  <Group gap={6}>
                    <Button
                      size="compact-xs"
                      color={HOSTEL_COLORS[hostel.hostelName] ? "indigo" : "gray"}
                      variant={activeTool === finishTool ? "filled" : "light"}
                      onClick={() => onActiveToolChange(finishTool)}
                    >
                      Set finish
                    </Button>
                    <Button
                      size="compact-xs"
                      variant={activeTool === waypointTool ? "filled" : "light"}
                      onClick={() => onActiveToolChange(waypointTool)}
                    >
                      Add line point
                    </Button>
                    <Button size="compact-xs" variant="subtle" color="gray" onClick={() => onHostelPolylineClear(hostel.hostelName)}>
                      Clear line
                    </Button>
                  </Group>
                </Stack>
              </Paper>
            );
          })}
        </SimpleGrid>

        <div className="promotion-route-map-shell">
          <div ref={mapElementRef} className="promotion-route-map" aria-label="Promotion route map editor" />
          <div className="promotion-route-map-hint">
            Blue solid line = street route. Green dashed line = ordered checkpoint link. Purple/pink/orange lines = hostel legs.
          </div>
        </div>
      </Stack>
    </Paper>
  );
};

export default PromotionRouteMapEditor;
