import { XMLParser, XMLValidator } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseAttributeValue: false,
  trimValues: true,
});

export function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function attribute(element, name) {
  return element?.[`@${name}`];
}

function vector(element, name) {
  const value = attribute(element, name);
  if (typeof value !== "string") return null;
  const numbers = value.trim().split(/\s+/).map(Number);
  return numbers.length === 3 && numbers.every(Number.isFinite)
    ? numbers
    : null;
}

function numberAttribute(element, name) {
  const value = Number(attribute(element, name));
  return Number.isFinite(value) ? value : null;
}

export function parseUrdf(xml) {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new Error(`Invalid URDF XML: ${validation.err.msg}`);
  }
  const document = parser.parse(xml);
  if (!document.robot || typeof document.robot !== "object") {
    throw new Error("URDF must have a <robot> root element.");
  }
  return {
    robot: document.robot,
    links: asArray(document.robot.link),
    joints: asArray(document.robot.joint),
  };
}

export function validateUrdf(xml) {
  const errors = [];
  const warnings = [];
  let model;

  try {
    model = parseUrdf(xml);
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : "Unable to parse URDF."],
      warnings,
      linkCount: 0,
      jointCount: 0,
      rootLink: null,
    };
  }

  const linkNames = new Set();
  for (const link of model.links) {
    const name = attribute(link, "name");
    if (typeof name !== "string" || name.length === 0) {
      errors.push("Every <link> must have a non-empty name.");
      continue;
    }
    if (linkNames.has(name)) errors.push(`Duplicate link name '${name}'.`);
    linkNames.add(name);
    if (asArray(link.visual).length === 0) {
      warnings.push(`Link '${name}' has no visual geometry.`);
    }
    if (asArray(link.collision).length === 0) {
      warnings.push(`Link '${name}' has no collision geometry.`);
    }
    const inertial = asArray(link.inertial)[0];
    if (!inertial) {
      warnings.push(`Link '${name}' has no inertial properties.`);
      continue;
    }
    const mass = numberAttribute(inertial.mass, "value");
    if (mass === null || mass <= 0) {
      errors.push(`Link '${name}' must have a positive mass.`);
    }
    const inertia = asArray(inertial.inertia)[0];
    const diagonal = ["ixx", "iyy", "izz"].map((key) =>
      numberAttribute(inertia, key),
    );
    if (diagonal.some((value) => value === null || value <= 0)) {
      errors.push(`Link '${name}' must have positive diagonal inertia values.`);
    }
  }

  if (model.links.length === 0) errors.push("URDF must define at least one link.");
  const jointNames = new Set();
  const childNames = new Set();
  const childrenByParent = new Map();
  const allowedTypes = new Set([
    "fixed",
    "revolute",
    "continuous",
    "prismatic",
    "floating",
    "planar",
  ]);

  for (const joint of model.joints) {
    const name = attribute(joint, "name");
    const type = attribute(joint, "type");
    const parent = attribute(asArray(joint.parent)[0], "link");
    const child = attribute(asArray(joint.child)[0], "link");
    if (typeof name !== "string" || name.length === 0) {
      errors.push("Every <joint> must have a non-empty name.");
    } else if (jointNames.has(name)) {
      errors.push(`Duplicate joint name '${name}'.`);
    } else {
      jointNames.add(name);
    }
    if (!allowedTypes.has(type)) {
      errors.push(`Joint '${name ?? "unnamed"}' has an unsupported type.`);
    }
    if (!linkNames.has(parent)) {
      errors.push(`Joint '${name ?? "unnamed"}' references missing parent link.`);
    }
    if (!linkNames.has(child)) {
      errors.push(`Joint '${name ?? "unnamed"}' references missing child link.`);
    }
    if (parent && child && parent === child) {
      errors.push(`Joint '${name ?? "unnamed"}' connects a link to itself.`);
    }
    if (childNames.has(child)) {
      errors.push(`Link '${child}' has more than one parent joint.`);
    }
    if (child) childNames.add(child);
    if (parent && child) {
      const children = childrenByParent.get(parent) ?? [];
      children.push(child);
      childrenByParent.set(parent, children);
    }
    if (type !== "fixed") {
      const axis = vector(asArray(joint.axis)[0], "xyz");
      if (!axis || Math.hypot(...axis) === 0) {
        errors.push(`Joint '${name ?? "unnamed"}' needs a non-zero axis.`);
      }
    }
    if (type === "revolute" || type === "prismatic") {
      const limit = asArray(joint.limit)[0];
      const lower = numberAttribute(limit, "lower");
      const upper = numberAttribute(limit, "upper");
      const effort = numberAttribute(limit, "effort");
      const velocity = numberAttribute(limit, "velocity");
      if (
        lower === null ||
        upper === null ||
        lower > upper ||
        effort === null ||
        effort <= 0 ||
        velocity === null ||
        velocity <= 0
      ) {
        errors.push(`Joint '${name ?? "unnamed"}' has invalid limits.`);
      }
    }
  }

  const roots = model.links
    .map((link) => attribute(link, "name"))
    .filter((name) => typeof name === "string" && !childNames.has(name));
  const rootLink = roots.length === 1 ? roots[0] : null;
  if (roots.length !== 1) {
    errors.push(`URDF must form one connected tree; found ${roots.length} root links.`);
  } else {
    const visited = new Set();
    const pending = [rootLink];
    while (pending.length > 0) {
      const current = pending.pop();
      if (visited.has(current)) continue;
      visited.add(current);
      pending.push(...(childrenByParent.get(current) ?? []));
    }
    if (visited.size !== model.links.length) {
      errors.push("URDF contains disconnected links or a joint cycle.");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    linkCount: model.links.length,
    jointCount: model.joints.length,
    rootLink,
  };
}

export function getDifferentialDriveGeometry(xml) {
  const model = parseUrdf(xml);
  const childLinks = new Set(
    model.joints.map((joint) => attribute(asArray(joint.child)[0], "link")),
  );
  const roots = model.links.filter(
    (link) => !childLinks.has(attribute(link, "name")),
  );
  const base = roots[0];
  const baseGeometry = asArray(asArray(base?.visual)[0]?.geometry)[0];
  const baseBox = asArray(baseGeometry?.box)[0];
  const baseSize = vector(baseBox, "size");
  if (!base || !baseSize) {
    throw new Error("Simulation requires a root base link with box visual geometry.");
  }

  const wheelJoints = model.joints.filter((joint) =>
    /wheel/i.test(attribute(joint, "name") ?? ""),
  );
  const wheelData = wheelJoints.map((joint) => {
    const childName = attribute(asArray(joint.child)[0], "link");
    const childLink = model.links.find(
      (link) => attribute(link, "name") === childName,
    );
    const geometry = asArray(asArray(childLink?.visual)[0]?.geometry)[0];
    const cylinder = asArray(geometry?.cylinder)[0];
    const radius = numberAttribute(cylinder, "radius");
    const origin = vector(asArray(joint.origin)[0], "xyz");
    if (radius === null || radius <= 0 || !origin) return null;
    return { name: attribute(joint, "name"), radius, lateralOffset: origin[1] };
  });
  const wheels = wheelData.filter((wheel) => wheel !== null);
  const leftWheel = wheels.find((wheel) => /left/i.test(wheel.name ?? ""));
  const rightWheel = wheels.find((wheel) => /right/i.test(wheel.name ?? ""));
  if (!leftWheel || !rightWheel) {
    throw new Error("Simulation requires left and right wheel joints with cylinder geometry.");
  }

  return {
    baseLength: baseSize[0],
    baseWidth: baseSize[1],
    wheelRadius: (leftWheel.radius + rightWheel.radius) / 2,
    wheelTrack: Math.abs(leftWheel.lateralOffset - rightWheel.lateralOffset),
  };
}
