import assert from "node:assert/strict";
import test from "node:test";
import { implement } from "./server.mjs";

const urdf = `<robot name="test_rover">
  <link name="base_link"><visual><geometry><box size="0.42 0.32 0.14"/></geometry></visual></link>
  <link name="left_wheel_link"><visual><geometry><cylinder radius="0.075" length="0.035"/></geometry></visual></link>
  <link name="right_wheel_link"><visual><geometry><cylinder radius="0.075" length="0.035"/></geometry></visual></link>
  <joint name="left_wheel_joint" type="continuous"><parent link="base_link"/><child link="left_wheel_link"/><origin xyz="0 0.14 0"/></joint>
  <joint name="right_wheel_joint" type="continuous"><parent link="base_link"/><child link="right_wheel_link"/><origin xyz="0 -0.14 0"/></joint>
</robot>`;

test("implementation agent generates a ROS 2 package skeleton from a URDF", () => {
  const result = implement({ urdf, requirements: { robotName: "Test Rover" } });

  assert.equal(result.packageName, "test_rover_bringup");
  assert.deepEqual(result.wheelJoints, {
    left: "left_wheel_joint",
    right: "right_wheel_joint",
  });
  assert.ok(result.files.some((file) => file.path.endsWith("config/controllers.yaml")));
  assert.ok(result.files.some((file) => file.path.endsWith("urdf/robot.urdf")));
});

test("implementation agent rejects URDF without a differential-drive model", () => {
  assert.throws(() => implement({ urdf: "<robot name='empty'></robot>" }), /root base link|wheel/i);
});

test("implementation agent applies package suffix and ROS 2 distribution settings", () => {
  const knowledgeContext = [{
    id: "knowledge-bsp",
    type: "BSP",
    name: "BSP knowledge Agent",
    description: "BSP guidance",
    guidance: "Confirm the target kernel and driver versions.",
  }];
  const result = implement({
    urdf,
    requirements: { robotName: "Test Rover" },
    knowledgeContext,
    options: { packageSuffix: "control", rosDistro: "humble" },
  });

  assert.equal(result.packageName, "test_rover_control");
  assert.deepEqual(result.knowledgeContext, knowledgeContext);
  const readme = result.files.find((file) => file.path.endsWith("README.md"));
  assert.ok(readme?.content.includes("/opt/ros/humble/setup.bash"));
  assert.ok(readme?.content.includes("Confirm the target kernel and driver versions."));
});
