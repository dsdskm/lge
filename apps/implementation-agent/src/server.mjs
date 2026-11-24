import {
  HttpError,
  readKnowledgeContext,
  startAgentServer,
} from "@workflow/agent-runtime";
import { getDifferentialDriveGeometry, parseUrdf } from "@workflow/robot-model";
import { pathToFileURL } from "node:url";

function packageSlug(value, suffix) {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safeSlug = /^[a-z_]/.test(slug) ? slug : `robot_${slug}`;
  return `${safeSlug || "robot"}_${suffix}`;
}

function xml(value) {
  return value.replace(/[<>&'"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    "\"": "&quot;",
  })[character]);
}

export function implement(body) {
  const knowledgeContext = readKnowledgeContext(body?.knowledgeContext);
  const urdf = body?.urdf;
  if (typeof urdf !== "string" || urdf.length === 0) {
    throw new HttpError(400, "urdf is required.");
  }
  if (urdf.length > 900_000) {
    throw new HttpError(413, "urdf must be 900 KB or smaller.");
  }
  const packageSuffix = body.options?.packageSuffix ?? "bringup";
  const rosDistro = body.options?.rosDistro ?? "jazzy";
  if (
    typeof packageSuffix !== "string" ||
    !/^[a-z][a-z0-9_]{0,20}$/.test(packageSuffix)
  ) {
    throw new HttpError(400, "packageSuffix must be a lowercase package name suffix.");
  }
  if (
    typeof rosDistro !== "string" ||
    !/^[a-z][a-z0-9_-]{0,30}$/.test(rosDistro)
  ) {
    throw new HttpError(400, "rosDistro must be a valid ROS 2 distribution name.");
  }

  let model;
  let geometry;
  try {
    model = parseUrdf(urdf);
    geometry = getDifferentialDriveGeometry(urdf);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "URDF model is invalid.");
  }

  const robotName =
    typeof body.requirements?.robotName === "string"
      ? body.requirements.robotName
      : model.robot["@name"] ?? "robot";
  const packageName = packageSlug(robotName, packageSuffix);
  const knowledgeNotes = knowledgeContext.length
    ? knowledgeContext.map((agent) => `- **${agent.name} (${agent.type}):** ${agent.guidance}`).join("\n")
    : "- No Knowledge Agent profiles were connected for this stage.";
  const wheelJoints = model.joints
    .filter((joint) => /wheel/i.test(joint["@name"] ?? ""))
    .map((joint) => joint["@name"]);
  const leftWheel = wheelJoints.find((name) => /left/i.test(name));
  const rightWheel = wheelJoints.find((name) => /right/i.test(name));
  if (!leftWheel || !rightWheel) {
    throw new HttpError(400, "URDF must define left and right wheel joints.");
  }

  const files = [
    {
      path: `${packageName}/package.xml`,
      content: `<?xml version="1.0"?>
<package format="3">
  <name>${xml(packageName)}</name>
  <version>0.1.0</version>
  <description>Prototype bring-up package generated from ${xml(robotName)} URDF.</description>
  <maintainer email="robotics@example.local">Robotics Workflow</maintainer>
  <license>Apache-2.0</license>
  <buildtool_depend>ament_cmake</buildtool_depend>
  <exec_depend>controller_manager</exec_depend>
  <exec_depend>diff_drive_controller</exec_depend>
  <exec_depend>joint_state_broadcaster</exec_depend>
  <exec_depend>robot_state_publisher</exec_depend>
</package>`,
    },
    {
      path: `${packageName}/CMakeLists.txt`,
      content: `cmake_minimum_required(VERSION 3.8)
project(${packageName})

find_package(ament_cmake REQUIRED)
install(DIRECTORY config urdf DESTINATION share/\${PROJECT_NAME})
ament_package()
`,
    },
    {
      path: `${packageName}/urdf/robot.urdf`,
      content: urdf,
    },
    {
      path: `${packageName}/config/controllers.yaml`,
      content: `controller_manager:
  ros__parameters:
    update_rate: 50
    joint_state_broadcaster:
      type: joint_state_broadcaster/JointStateBroadcaster
    diff_drive_controller:
      type: diff_drive_controller/DiffDriveController

diff_drive_controller:
  ros__parameters:
    left_wheel_names: ["${leftWheel}"]
    right_wheel_names: ["${rightWheel}"]
    wheel_separation: ${geometry.wheelTrack}
    wheel_radius: ${geometry.wheelRadius}
    base_frame_id: base_link
    odom_frame_id: odom
    enable_odom_tf: true
    use_stamped_vel: false
`,
    },
    {
      path: `${packageName}/README.md`,
      content: `# ${robotName} ROS 2 bring-up prototype

This package contains the generated URDF and differential-drive controller configuration.

## Build

\`\`\`sh
source /opt/ros/${rosDistro}/setup.bash
colcon build --packages-select ${packageName}
source install/setup.bash
\`\`\`

## Hardware integration required

Add a \`ros2_control\` block and a hardware interface plugin for the target motor controller before spawning the controllers. Verify joint limits, wheel direction, emergency stop behavior, and odometry on the target robot.

## Knowledge guidance

${knowledgeNotes}
`,
    },
  ];

  return {
    agent: "implementation-agent",
    robotName,
    packageName,
    rosDistro,
    knowledgeContext,
    wheelJoints: { left: leftWheel, right: rightWheel },
    geometry,
    files,
    limitations: [
      "This is a ROS 2 package skeleton, not a hardware driver or a validated robot implementation.",
      "A ros2_control hardware interface, motor driver, and on-robot verification are still required.",
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startAgentServer({
    name: "implementation-agent",
    port: Number(process.env.IMPLEMENTATION_AGENT_PORT || 4325),
    routes: { "POST /implement": implement },
  });
}
