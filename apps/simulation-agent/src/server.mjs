import {
  HttpError,
  readKnowledgeContext,
  startAgentServer,
} from "@workflow/agent-runtime";
import { getDifferentialDriveGeometry } from "@workflow/robot-model";
import { pathToFileURL } from "node:url";

function boundedNumber(value, field, minimum, maximum) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new HttpError(
      400,
      `${field} must be a number between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

export function simulate(body) {
  const knowledgeContext = readKnowledgeContext(body?.knowledgeContext);
  if (typeof body.urdf !== "string" || body.urdf.length === 0) {
    throw new HttpError(400, "urdf is required.");
  }
  if (body.urdf.length > 900_000) {
    throw new HttpError(413, "urdf must be 900 KB or smaller.");
  }
  const scenario = body.scenario ?? {};
  const durationSec = boundedNumber(scenario.durationSec, "durationSec", 0.1, 60);
  const linearVelocity = boundedNumber(
    scenario.linearVelocity,
    "linearVelocity",
    -1,
    1,
  );
  const angularVelocity = boundedNumber(
    scenario.angularVelocity,
    "angularVelocity",
    -3.14,
    3.14,
  );
  const timeStep = boundedNumber(scenario.timeStep, "timeStep", 0.02, 0.5);
  const obstacles = scenario.obstacles ?? [];
  if (!Array.isArray(obstacles) || obstacles.length > 30) {
    throw new HttpError(400, "obstacles must be an array with at most 30 items.");
  }
  const normalizedObstacles = obstacles.map((obstacle, index) => ({
    x: boundedNumber(obstacle?.x, `obstacles[${index}].x`, -100, 100),
    y: boundedNumber(obstacle?.y, `obstacles[${index}].y`, -100, 100),
    radius: boundedNumber(obstacle?.radius, `obstacles[${index}].radius`, 0.05, 10),
  }));
  const geometry = getDifferentialDriveGeometry(body.urdf);
  const robotRadius = Math.hypot(geometry.baseLength, geometry.baseWidth) / 2;
  const steps = Math.ceil(durationSec / timeStep);
  const dt = durationSec / steps;
  const trajectory = [{ time: 0, x: 0, y: 0, yaw: 0 }];
  const collisions = [];
  let x = 0;
  let y = 0;
  let yaw = 0;
  let distanceTravelled = 0;

  for (const [obstacleIndex, obstacle] of normalizedObstacles.entries()) {
    if (Math.hypot(obstacle.x, obstacle.y) <= robotRadius + obstacle.radius) {
      collisions.push({ time: 0, obstacleIndex });
    }
  }

  for (let index = 1; index <= steps; index += 1) {
    const midpointYaw = yaw + angularVelocity * dt / 2;
    const deltaX = linearVelocity * Math.cos(midpointYaw) * dt;
    const deltaY = linearVelocity * Math.sin(midpointYaw) * dt;
    x += deltaX;
    y += deltaY;
    yaw += angularVelocity * dt;
    distanceTravelled += Math.hypot(deltaX, deltaY);
    const time = index * dt;
    trajectory.push({ time, x, y, yaw });

    for (const [obstacleIndex, obstacle] of normalizedObstacles.entries()) {
      if (
        Math.hypot(x - obstacle.x, y - obstacle.y) <=
          robotRadius + obstacle.radius &&
        !collisions.some((collision) => collision.obstacleIndex === obstacleIndex)
      ) {
        collisions.push({ time, obstacleIndex });
      }
    }
  }

  return {
    simulator: "differential-drive-2d-kinematics",
    fidelity: "kinematic-preview",
    knowledgeContext,
    knowledgeReview: knowledgeContext.map(({ name, guidance }) => ({
      agent: name,
      guidance,
      verified: false,
    })),
    robot: geometry,
    scenario: {
      durationSec,
      linearVelocity,
      angularVelocity,
      timeStep: dt,
      obstacles: normalizedObstacles,
    },
    trajectory,
    metrics: {
      distanceTravelled,
      finalPose: { x, y, yaw },
      collisionCount: collisions.length,
      firstCollision: collisions[0] ?? null,
      passed: collisions.length === 0,
    },
    limitations: [
      "This is a planar kinematic preview, not a physics simulation.",
      "It does not model gravity, inertia, traction, wheel slip, sensors, or 3D collisions.",
      "Use ROS 2 and Gazebo on Ubuntu for physical simulation and final verification.",
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startAgentServer({
    name: "simulation-agent",
    port: Number(process.env.SIMULATION_AGENT_PORT || 4323),
    routes: {
      "POST /simulate": simulate,
    },
  });
}
