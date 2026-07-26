import { useMemo } from "react";
import type { DeviceCommand, LightMode } from "@octodesk/core";

const COLORS: Record<string, string> = {
  off: "#28324e",
  white: "#e8eaf2",
  yellow: "#ffc93c",
  green: "#3ddc84",
  blue: "#4da3ff",
  red: "#ff4d5a",
};

const CX = 400;
const CY = 190;

interface LegGeometry {
  leg: number;
  path: string;
  tip: { x: number; y: number };
  label: { x: number; y: number };
}

function buildLegs(): LegGeometry[] {
  const legs: LegGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const phi = ((-105 + i * 30) * Math.PI) / 180; // fan from lower-left to lower-right
    const dx = Math.sin(phi);
    const dy = Math.cos(phi);
    const px = dy; // perpendicular, for the tentacle wiggle
    const py = -dx;
    const at = (r: number, wiggle: number) => ({
      x: CX + dx * r + px * wiggle,
      y: CY + dy * r + py * wiggle,
    });
    const base = at(82, 0);
    const c1 = at(150, 24);
    const c2 = at(215, -24);
    const tip = at(272, 0);
    legs.push({
      leg: i + 1,
      path: `M ${base.x.toFixed(1)} ${base.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${tip.x.toFixed(1)} ${tip.y.toFixed(1)}`,
      tip,
      label: at(305, 0),
    });
  }
  return legs;
}

function lightStyle(color: string, mode: LightMode): React.CSSProperties {
  const c = COLORS[color] ?? COLORS.off;
  return {
    color: c,
    filter: mode === "off" ? undefined : `drop-shadow(0 0 9px ${c})`,
  };
}

export function Octopus({
  frame,
  selectedLeg,
  onPress,
}: {
  frame: DeviceCommand[];
  selectedLeg: number | null;
  onPress: (target: "head" | "leg", leg?: number) => void;
}) {
  const legs = useMemo(buildLegs, []);
  const legCommands = new Map(frame.filter((c) => c.target === "leg").map((c) => [c.leg, c]));
  const head = frame.find((c) => c.target === "head");
  const headMode: LightMode = head?.mode ?? "off";

  return (
    <svg viewBox="0 0 800 560" className="octopus" role="group" aria-label="Virtual octopus">
      {legs.map(({ leg, path, tip, label }) => {
        const cmd = legCommands.get(leg);
        const color = cmd?.color ?? "off";
        const mode: LightMode = cmd?.mode ?? "off";
        return (
          <g
            key={leg}
            className={`leg mode-${mode}`}
            style={lightStyle(color, mode)}
            onClick={() => onPress("leg", leg)}
          >
            {/* wide invisible hit area so tentacles are easy to click */}
            <path d={path} className="leg-hit" />
            <path d={path} className="leg-stroke" />
            <circle cx={tip.x} cy={tip.y} r={16} className="leg-tip" />
            {selectedLeg === leg && (
              <circle cx={tip.x} cy={tip.y} r={26} className="selected-ring" />
            )}
            <text x={label.x} y={label.y} className="leg-label">
              {leg}
            </text>
          </g>
        );
      })}

      <g className="head" onClick={() => onPress("head")}>
        <circle
          cx={CX}
          cy={CY}
          r={112}
          className={`head-ring mode-${headMode}`}
          style={lightStyle(head?.color ?? "off", headMode)}
        />
        <circle cx={CX} cy={CY} r={104} className="head-body" />
        {/* eyes */}
        <ellipse cx={CX - 38} cy={CY + 8} rx={20} ry={24} className="eye" />
        <ellipse cx={CX + 38} cy={CY + 8} rx={20} ry={24} className="eye" />
        <circle cx={CX - 34} cy={CY + 12} r={9} className="pupil" />
        <circle cx={CX + 42} cy={CY + 12} r={9} className="pupil" />
        {/* little smile */}
        <path
          d={`M ${CX - 16} ${CY + 52} Q ${CX} ${CY + 64} ${CX + 16} ${CY + 52}`}
          className="smile"
        />
      </g>
    </svg>
  );
}
