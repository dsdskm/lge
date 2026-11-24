import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { HttpError, readKnowledgeContext } from "@workflow/agent-runtime";

function requireNumber(value, name, minimum, maximum) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new HttpError(
      400,
      `${name} must be a number between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function formatNumber(value) {
  return Number(value.toFixed(6)).toString();
}

function robotXmlName(value) {
  const name = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[a-z_]/.test(name) ? name : `robot_${name || "prototype"}`;
}

function validateRequirements(input) {
  if (typeof input !== "object" || input === null) {
    throw new HttpError(400, "requirements must be an object.");
  }
  const robotName = input.robotName?.trim();
  if (typeof robotName !== "string" || robotName.length === 0) {
    throw new HttpError(400, "requirements.robotName is required.");
  }
  if (robotName.length > 80) {
    throw new HttpError(400, "requirements.robotName must be 80 characters or fewer.");
  }
  const designBrief = input.designBrief?.trim() ?? "";
  if (designBrief.length > 4000) {
    throw new HttpError(400, "requirements.designBrief must be 4000 characters or fewer.");
  }
  const dimensions = input.dimensions ?? {};
  return {
    robotName,
    designBrief,
    dimensions: {
      baseLength: requireNumber(dimensions.baseLength, "baseLength", 0.15, 2),
      baseWidth: requireNumber(dimensions.baseWidth, "baseWidth", 0.15, 2),
      bodyHeight: requireNumber(dimensions.bodyHeight, "bodyHeight", 0.05, 1),
      wheelRadius: requireNumber(dimensions.wheelRadius, "wheelRadius", 0.03, 0.4),
      wheelWidth: requireNumber(dimensions.wheelWidth, "wheelWidth", 0.01, 0.2),
      wheelTrack: requireNumber(dimensions.wheelTrack, "wheelTrack", 0.08, 1.8),
      chassisMass: requireNumber(dimensions.chassisMass, "chassisMass", 0.5, 200),
    },
  };
}

function createUrdf(requirements) {
  const { dimensions } = requirements;
  const {
    baseLength,
    baseWidth,
    bodyHeight,
    wheelRadius,
    wheelWidth,
    wheelTrack,
    chassisMass,
  } = dimensions;
  const wheelMass = Math.min(1.2, chassisMass * 0.08);
  const wheelIxx = wheelMass * (3 * wheelRadius ** 2 + wheelWidth ** 2) / 12;
  const wheelIyy = wheelMass * wheelRadius ** 2 / 2;
  const wheelIzz = wheelIxx;
  const bodyIxx = chassisMass * (baseWidth ** 2 + bodyHeight ** 2) / 12;
  const bodyIyy = chassisMass * (baseLength ** 2 + bodyHeight ** 2) / 12;
  const bodyIzz = chassisMass * (baseLength ** 2 + baseWidth ** 2) / 12;
  const chassisZ = wheelRadius + bodyHeight / 2;
  const name = robotXmlName(requirements.robotName);
  const n = formatNumber;

  return `<?xml version="1.0"?>
<robot name="${name}">
  <material name="chassis_blue"><color rgba="0.16 0.35 0.66 1"/></material>
  <material name="wheel_dark"><color rgba="0.12 0.13 0.15 1"/></material>
  <link name="base_link">
    <inertial>
      <origin xyz="0 0 ${n(chassisZ)}"/>
      <mass value="${n(chassisMass)}"/>
      <inertia ixx="${n(bodyIxx)}" ixy="0" ixz="0" iyy="${n(bodyIyy)}" iyz="0" izz="${n(bodyIzz)}"/>
    </inertial>
    <visual>
      <origin xyz="0 0 ${n(chassisZ)}"/>
      <geometry><box size="${n(baseLength)} ${n(baseWidth)} ${n(bodyHeight)}"/></geometry>
      <material name="chassis_blue"/>
    </visual>
    <collision>
      <origin xyz="0 0 ${n(chassisZ)}"/>
      <geometry><box size="${n(baseLength)} ${n(baseWidth)} ${n(bodyHeight)}"/></geometry>
    </collision>
  </link>
  <link name="left_wheel_link">
    <inertial>
      <mass value="${n(wheelMass)}"/>
      <inertia ixx="${n(wheelIxx)}" ixy="0" ixz="0" iyy="${n(wheelIyy)}" iyz="0" izz="${n(wheelIzz)}"/>
    </inertial>
    <visual><origin rpy="1.570796 0 0"/><geometry><cylinder radius="${n(wheelRadius)}" length="${n(wheelWidth)}"/></geometry><material name="wheel_dark"/></visual>
    <collision><origin rpy="1.570796 0 0"/><geometry><cylinder radius="${n(wheelRadius)}" length="${n(wheelWidth)}"/></geometry></collision>
  </link>
  <joint name="left_wheel_joint" type="continuous">
    <parent link="base_link"/><child link="left_wheel_link"/>
    <origin xyz="0 ${n(wheelTrack / 2)} 0"/><axis xyz="0 1 0"/>
    <limit effort="8" velocity="18"/>
  </joint>
  <link name="right_wheel_link">
    <inertial>
      <mass value="${n(wheelMass)}"/>
      <inertia ixx="${n(wheelIxx)}" ixy="0" ixz="0" iyy="${n(wheelIyy)}" iyz="0" izz="${n(wheelIzz)}"/>
    </inertial>
    <visual><origin rpy="1.570796 0 0"/><geometry><cylinder radius="${n(wheelRadius)}" length="${n(wheelWidth)}"/></geometry><material name="wheel_dark"/></visual>
    <collision><origin rpy="1.570796 0 0"/><geometry><cylinder radius="${n(wheelRadius)}" length="${n(wheelWidth)}"/></geometry></collision>
  </link>
  <joint name="right_wheel_joint" type="continuous">
    <parent link="base_link"/><child link="right_wheel_link"/>
    <origin xyz="0 -${n(wheelTrack / 2)} 0"/><axis xyz="0 1 0"/>
    <limit effort="8" velocity="18"/>
  </joint>
  <link name="rear_caster_link">
    <inertial>
      <mass value="${n(Math.max(0.05, wheelMass / 4))}"/>
      <inertia ixx="0.0001" ixy="0" ixz="0" iyy="0.0001" iyz="0" izz="0.0001"/>
    </inertial>
    <visual><geometry><sphere radius="0.025"/></geometry><material name="wheel_dark"/></visual>
    <collision><geometry><sphere radius="0.025"/></geometry></collision>
  </link>
  <joint name="rear_caster_joint" type="fixed">
    <parent link="base_link"/><child link="rear_caster_link"/>
    <origin xyz="-${n(baseLength * 0.38)} 0 -${n(wheelRadius - 0.025)}"/>
  </joint>
</robot>`;
}

function callClaude(prompt) {
  const command = process.env.CLAUDE_CLI_PATH || "claude";
  const claudeEnvironment = Object.fromEntries(
    [
      "PATH",
      "HOME",
      "USER",
      "LOGNAME",
      "SHELL",
      "LANG",
      "LC_ALL",
      "TERM",
      "TMPDIR",
      "CLAUDE_CONFIG_DIR",
    ]
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(
      command,
      [
        "--print",
        "--output-format",
        "json",
        "--no-session-persistence",
        "--tools",
        "",
      ],
      {
        cwd: tmpdir(),
        env: claudeEnvironment,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let outputTooLarge = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, 120_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 512_000) {
        outputTooLarge = true;
        child.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 16_000) stderr += chunk;
    });
    child.stdin.once("error", (error) => {
      if (error.code === "EPIPE") return;
      clearTimeout(timer);
      reject(new HttpError(502, "Could not send the prompt to Claude CLI."));
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(new HttpError(503, "Claude CLI could not be started."));
    });
    child.stdin.end(prompt);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new HttpError(504, "Claude CLI exceeded the 120 second timeout."));
        return;
      }
      if (outputTooLarge) {
        reject(new HttpError(502, "Claude CLI returned an oversized response."));
        return;
      }
      if (code !== 0) {
        const detail = stderr.trim().split("\n")[0]?.slice(0, 240);
        reject(
          new HttpError(
            502,
            detail
              ? `Claude CLI failed: ${detail}`
              : `Claude CLI exited with code ${code}.`,
          ),
        );
        return;
      }
      try {
        const envelope = JSON.parse(stdout);
        if (envelope.is_error || typeof envelope.result !== "string") {
          throw new Error("Claude CLI did not return a result.");
        }
        resolve(envelope.result.trim());
      } catch (error) {
        reject(
          new HttpError(
            502,
            error instanceof Error ? error.message : "Claude CLI returned invalid JSON.",
          ),
        );
      }
    });
  });
}

async function createConcept(requirements, engine, knowledgeContext) {
  if (engine === "template") {
    return `Compact indoor mobile base with a ${requirements.dimensions.baseLength.toFixed(2)} m blue chassis, paired drive wheels, and a rear caster.`;
  }
  if (engine !== "claude-cli") {
    throw new HttpError(500, "DESIGN_AGENT_ENGINE must be 'claude-cli' or 'template'.");
  }

  const prompt = [
    "You are the exterior concept designer for a small indoor differential-drive robot.",
    "Suggest a concise, practical exterior concept in Korean. Do not generate code, XML, commands, or claims about physical safety.",
    "Mention only visual form, accessible component layout, and assumptions that need human review.",
    "Keep the answer under 120 words.",
    `Robot name: ${requirements.robotName}`,
    `Design brief: ${requirements.designBrief || "No additional brief."}`,
    `Dimensions in meters and kilograms: ${JSON.stringify(requirements.dimensions)}`,
    "Knowledge guidance to consider:",
    ...knowledgeContext.map(({ name, type, guidance }) => `${name} (${type}): ${guidance}`),
  ].join("\n");
  return callClaude(prompt);
}

export async function designRobot(body) {
  const requirements = validateRequirements(body?.requirements);
  const knowledgeContext = readKnowledgeContext(body?.knowledgeContext);
  const engine =
    typeof body?.options?.engine === "string"
      ? body.options.engine
      : process.env.DESIGN_AGENT_ENGINE || "claude-cli";
  const concept = await createConcept(requirements, engine, knowledgeContext);
  return {
    robotName: requirements.robotName,
    engine,
    concept,
    knowledgeContext,
    dimensions: requirements.dimensions,
    urdf: createUrdf(requirements),
    limitations: [
      "URDF geometry uses primitive shapes; it is a visual prototype, not a manufacturing CAD model.",
      "Mass and inertia are estimates and require engineering review.",
    ],
  };
}
