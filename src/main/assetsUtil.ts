import { dialog } from "electron";
import fs from "fs";
import jsonfile from "jsonfile";
import path from "path";
import {
  AdvantageScopeAssets,
  Config2d,
  Config3dField,
  Config3dField_GamePiece,
  Config3dRobot,
  Config3dRobot_Camera,
  Config3dRobot_Component,
  ConfigJoystick,
  ConfigJoystick_Axis,
  ConfigJoystick_Button,
  ConfigJoystick_Joystick,
  DEFAULT_DRIVER_STATIONS
} from "../shared/AdvantageScopeAssets";
import Preferences from "../shared/Preferences";
import { checkArrayType } from "../shared/util";
import {
  AUTO_ASSETS,
  BUNDLED_ASSETS,
  DEFAULT_USER_ASSETS,
  LEGACY_ASSETS,
  PREFS_FILENAME,
  WINDOW_ICON
} from "./Constants";

const USER_ASSETS_README =
  'This folder contains extra assets for the odometry, 3D field, and joystick views. For more details, see the "Custom Fields/Robots/Joysticks" page in the AdvantageScope documentation (available through the documentation tab in the app or the URL below).\n\nhttps://github.com/Mechanical-Advantage/AdvantageScope/blob/main/docs/CUSTOM-ASSETS.md';
const CONVERT_LEGACY_ALLOWED_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWxYZabcdefghijklnopqrstuvwxyz0123456789".split("");

/** Returns the path to the user assets folder. */
export function getUserAssetsPath() {
  const prefs: Preferences = jsonfile.readFileSync(PREFS_FILENAME);
  if (prefs.userAssetsFolder === null) {
    return DEFAULT_USER_ASSETS;
  } else {
    return prefs.userAssetsFolder;
  }
}

/** Creates folders for user and automatic assets. */
export function createAssetFolders() {
  if (!fs.existsSync(AUTO_ASSETS)) {
    fs.mkdirSync(AUTO_ASSETS);
  }
  if (!fs.existsSync(DEFAULT_USER_ASSETS)) {
    fs.mkdirSync(DEFAULT_USER_ASSETS);
  }
  fs.writeFileSync(path.join(DEFAULT_USER_ASSETS, "README.txt"), USER_ASSETS_README);
}

/** Converts any custom "FRC Data" assets to the current format. */
export function convertLegacyAssets() {
  if (!fs.existsSync(LEGACY_ASSETS)) return;
  if (fs.readdirSync(LEGACY_ASSETS).filter((x) => !x.startsWith(".")).length <= 1) {
    // Delete unused FRC data folder
    fs.rmSync(LEGACY_ASSETS, { recursive: true });
    return;
  }

  // Prompt user to confirm
  let result = dialog.showMessageBoxSync({
    type: "info",
    title: "Info",
    message: "Convert legacy AdvantageScope assets?",
    detail:
      'Legacy "FRC Data" assets found. Click "Continue" to convert to a format compatible with this version of AdvantageScope.',
    buttons: ["Continue", "Cancel"],
    icon: WINDOW_ICON
  });
  if (result !== 0) return;

  // Convert assets
  fs.readdirSync(LEGACY_ASSETS).forEach((file) => {
    if (!file.endsWith(".json")) return;
    let title = file.split("_").slice(1).join("_").split(".").slice(0, -1).join(".");
    let config = jsonfile.readFileSync(path.join(LEGACY_ASSETS, file));
    let isField2d = file.startsWith("Field2d_");
    let isField3d = file.startsWith("Field3d_");
    let isRobot = file.startsWith("Robot_");
    let isJoystick = file.startsWith("Joystick_");

    // Create target folder
    let targetPath = path.join(
      DEFAULT_USER_ASSETS,
      file.split("_")[0] +
        "_" +
        title
          .split("")
          .filter((x) => CONVERT_LEGACY_ALLOWED_CHARS.includes(x))
          .join("")
    );
    if (fs.existsSync(targetPath)) return;
    fs.mkdirSync(targetPath);

    // Copy assets
    if (isField2d) {
      fs.copyFileSync(path.join(LEGACY_ASSETS, "Field2d_" + title + ".png"), path.join(targetPath, "image.png"));
    } else if (isField3d) {
      fs.copyFileSync(path.join(LEGACY_ASSETS, "Field3d_" + title + ".glb"), path.join(targetPath, "model.glb"));
    } else if (isRobot) {
      fs.copyFileSync(path.join(LEGACY_ASSETS, "Robot_" + title + ".glb"), path.join(targetPath, "model.glb"));
      let index = 0;
      while (true) {
        let source = path.join(LEGACY_ASSETS, "Robot_" + title + "_" + index.toString() + ".glb");
        if (!fs.existsSync(source)) break;
        fs.copyFileSync(source, path.join(targetPath, "model_" + index.toString() + ".glb"));
        index++;
      }
    } else if (isJoystick) {
      fs.copyFileSync(path.join(LEGACY_ASSETS, "Joystick_" + title + ".png"), path.join(targetPath, "image.png"));
    }

    // Update config
    if (isJoystick) {
      config = {
        name: title,
        components: config
      };
    }
    config.name = title;
    jsonfile.writeFileSync(path.join(targetPath, "config.json"), config, { spaces: 2 });
  });

  // Delete FRC data folder
  fs.rmSync(LEGACY_ASSETS, { recursive: true });
}

/** Loads all current FRC data (bundled and extra). */
export function loadAssets(): AdvantageScopeAssets {
  let assets: AdvantageScopeAssets = {
    field2ds: [],
    field3ds: [],
    robots: [],
    joysticks: [],
    loadFailures: []
  };

  // Highest priority is first
  [getUserAssetsPath(), AUTO_ASSETS, BUNDLED_ASSETS].forEach((parentFolder) => {
    fs.readdirSync(parentFolder, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0)) // Inverse order so newer versions take priority
      .forEach((object) => {
        if (!object.isDirectory() || object.name.startsWith(".")) return;
        assets.loadFailures.push(object.name); // Assume failure, remove if successful
        let isField2d = object.name.startsWith("Field2d_");
        let isField3d = object.name.startsWith("Field3d_");
        let isRobot = object.name.startsWith("Robot_");
        let isJoystick = object.name.startsWith("Joystick_");

        let configPath = path.join(parentFolder, object.name, "config.json");
        if (!fs.existsSync(configPath)) return;
        let configRaw: unknown;
        try {
          configRaw = jsonfile.readFileSync(configPath);
        } catch {
          return;
        }
        if (configRaw === null || typeof configRaw !== "object") return;

        if (isField2d) {
          // ***** 2D FIELD *****
          let config: Config2d = {
            name: "",
            path: encodePath(path.join(parentFolder, object.name, "image.png")),
            topLeft: [-1, -1],
            bottomRight: [-1, -1],
            widthInches: 0,
            heightInches: 0,
            defaultOrigin: "auto"
          };
          if ("name" in configRaw && typeof configRaw.name === "string") {
            config.name = configRaw.name;
          }
          if ("sourceUrl" in configRaw && typeof configRaw.sourceUrl === "string") {
            config.sourceUrl = configRaw.sourceUrl;
          }
          if (
            "topLeft" in configRaw &&
            checkArrayType(configRaw.topLeft, "number") &&
            (configRaw.topLeft as number[]).length === 2
          ) {
            config.topLeft = configRaw.topLeft as [number, number];
          }
          if (
            "bottomRight" in configRaw &&
            checkArrayType(configRaw.bottomRight, "number") &&
            (configRaw.bottomRight as number[]).length === 2
          ) {
            config.bottomRight = configRaw.bottomRight as [number, number];
          }
          if ("widthInches" in configRaw && typeof configRaw.widthInches === "number") {
            config.widthInches = configRaw.widthInches;
          }
          if ("heightInches" in configRaw && typeof configRaw.heightInches === "number") {
            config.heightInches = configRaw.heightInches;
          }
          if (
            "defaultOrigin" in configRaw &&
            typeof configRaw.defaultOrigin === "string" &&
            (configRaw.defaultOrigin === "auto" ||
              configRaw.defaultOrigin === "red" ||
              configRaw.defaultOrigin === "blue")
          ) {
            config.defaultOrigin = configRaw.defaultOrigin;
          }
          if (
            config.name.length > 0 &&
            config.topLeft[0] >= 0 &&
            config.topLeft[1] >= 0 &&
            config.bottomRight[0] >= 0 &&
            config.bottomRight[1] >= 0 &&
            config.widthInches > 0 &&
            config.heightInches > 0 &&
            fs.existsSync(decodeURIComponent(config.path))
          ) {
            assets.field2ds.push(config);
            assets.loadFailures.splice(assets.loadFailures.indexOf(object.name), 1);
          }
        } else if (isField3d) {
          // ***** 3D FIELD *****
          let config: Config3dField = {
            name: "",
            path: encodePath(path.join(parentFolder, object.name, "model.glb")),
            rotations: [],
            widthInches: 0,
            heightInches: 0,
            defaultOrigin: "auto",
            driverStations: DEFAULT_DRIVER_STATIONS,
            gamePieces: []
          };
          if ("name" in configRaw && typeof configRaw.name === "string") {
            config.name = configRaw.name;
          }
          if ("sourceUrl" in configRaw && typeof configRaw.sourceUrl === "string") {
            config.sourceUrl = configRaw.sourceUrl;
          }
          if (
            "rotations" in configRaw &&
            Array.isArray(configRaw.rotations) &&
            configRaw.rotations.every(
              (rotation: any) =>
                typeof rotation === "object" &&
                "axis" in rotation &&
                (rotation.axis === "x" || rotation.axis === "y" || rotation.axis === "z") &&
                "degrees" in rotation &&
                typeof rotation.degrees === "number"
            )
          ) {
            config.rotations = configRaw.rotations;
          }
          if ("widthInches" in configRaw && typeof configRaw.widthInches === "number") {
            config.widthInches = configRaw.widthInches;
          }
          if ("heightInches" in configRaw && typeof configRaw.heightInches === "number") {
            config.heightInches = configRaw.heightInches;
          }
          if (
            "defaultOrigin" in configRaw &&
            typeof configRaw.defaultOrigin === "string" &&
            (configRaw.defaultOrigin === "auto" ||
              configRaw.defaultOrigin === "red" ||
              configRaw.defaultOrigin === "blue")
          ) {
            config.defaultOrigin = configRaw.defaultOrigin;
          }
          if (
            "driverStations" in configRaw &&
            Array.isArray(configRaw.driverStations) &&
            configRaw.driverStations.length === 6 &&
            configRaw.driverStations.every((position) => checkArrayType(position, "number") && position.length === 2)
          ) {
            config.driverStations = configRaw.driverStations;
          }
          if ("gamePieces" in configRaw && Array.isArray(configRaw.gamePieces)) {
            configRaw.gamePieces.forEach((gamePieceRaw: any) => {
              let gamePiece: Config3dField_GamePiece = {
                name: "",
                rotations: [],
                position: [0, 0, 0],
                stagedObjects: []
              };
              config.gamePieces.push(gamePiece);
              if ("name" in gamePieceRaw && typeof gamePieceRaw.name === "string") {
                gamePiece.name = gamePieceRaw.name;
              }
              if (
                "rotations" in gamePieceRaw &&
                Array.isArray(gamePieceRaw.rotations) &&
                gamePieceRaw.rotations.every(
                  (rotation: any) =>
                    typeof rotation === "object" &&
                    "axis" in rotation &&
                    (rotation.axis === "x" || rotation.axis === "y" || rotation.axis === "z") &&
                    "degrees" in rotation &&
                    typeof rotation.degrees === "number"
                )
              ) {
                gamePiece.rotations = gamePieceRaw.rotations;
              }
              if (
                "position" in gamePieceRaw &&
                checkArrayType(gamePieceRaw.position, "number") &&
                gamePieceRaw.position.length === 3
              ) {
                gamePiece.position = gamePieceRaw.position;
              }
              if ("stagedObjects" in gamePieceRaw && checkArrayType(gamePieceRaw.stagedObjects, "string")) {
                gamePiece.stagedObjects = gamePieceRaw.stagedObjects;
              }
            });
          }
          if (
            config.name.length > 0 &&
            config.widthInches > 0 &&
            config.heightInches > 0 &&
            fs.existsSync(decodeURIComponent(config.path)) &&
            config.gamePieces.every((value, index) =>
              fs.existsSync(decodeURIComponent(config.path).slice(0, -4) + "_" + index.toString() + ".glb")
            )
          ) {
            assets.field3ds.push(config);
            assets.loadFailures.splice(assets.loadFailures.indexOf(object.name), 1);
          }
        } else if (isRobot) {
          // ***** 3D ROBOT *****
          let config: Config3dRobot = {
            name: "",
            path: encodePath(path.join(parentFolder, object.name, "model.glb")),
            rotations: [],
            position: [0, 0, 0],
            cameras: [],
            components: [],
            disableSimplification: false
          };
          if ("name" in configRaw && typeof configRaw.name === "string") {
            config.name = configRaw.name;
          }
          if ("sourceUrl" in configRaw && typeof configRaw.sourceUrl === "string") {
            config.sourceUrl = configRaw.sourceUrl;
          }
          if (config.name === "Preseto") {
            console.log(configRaw);
          }
          if ("disableSimplification" in configRaw && typeof configRaw.disableSimplification === "boolean") {
            config.disableSimplification = configRaw.disableSimplification;
          }
          if (
            "rotations" in configRaw &&
            Array.isArray(configRaw.rotations) &&
            configRaw.rotations.every(
              (rotation: any) =>
                typeof rotation === "object" &&
                "axis" in rotation &&
                (rotation.axis === "x" || rotation.axis === "y" || rotation.axis === "z") &&
                "degrees" in rotation &&
                typeof rotation.degrees === "number"
            )
          ) {
            config.rotations = configRaw.rotations;
          }
          if (
            "position" in configRaw &&
            checkArrayType(configRaw.position, "number") &&
            (configRaw.position as number[]).length === 3
          ) {
            config.position = configRaw.position as [number, number, number];
          }
          if ("cameras" in configRaw && Array.isArray(configRaw.cameras)) {
            configRaw.cameras.forEach((cameraRaw: any) => {
              let camera: Config3dRobot_Camera = {
                name: "",
                rotations: [],
                position: [0, 0, 0],
                resolution: [200, 100],
                fov: 90
              };
              config.cameras.push(camera);
              if ("name" in cameraRaw && typeof cameraRaw.name === "string") {
                camera.name = cameraRaw.name;
              }
              if (
                "rotations" in cameraRaw &&
                Array.isArray(cameraRaw.rotations) &&
                cameraRaw.rotations.every(
                  (rotation: any) =>
                    typeof rotation === "object" &&
                    "axis" in rotation &&
                    (rotation.axis === "x" || rotation.axis === "y" || rotation.axis === "z") &&
                    "degrees" in rotation &&
                    typeof rotation.degrees === "number"
                )
              ) {
                camera.rotations = cameraRaw.rotations;
              }
              if (
                "position" in cameraRaw &&
                checkArrayType(cameraRaw.position, "number") &&
                cameraRaw.position.length === 3
              ) {
                camera.position = cameraRaw.position;
              }
              if (
                "resolution" in cameraRaw &&
                checkArrayType(cameraRaw.resolution, "number") &&
                cameraRaw.resolution.length === 2
              ) {
                camera.resolution = cameraRaw.resolution;
              }
              if ("fov" in cameraRaw && typeof cameraRaw.fov === "number") {
                camera.fov = cameraRaw.fov;
              }
            });
          }
          if ("components" in configRaw && Array.isArray(configRaw.components)) {
            configRaw.components.forEach((componentRaw: any) => {
              let component: Config3dRobot_Component = {
                zeroedRotations: [],
                zeroedPosition: [0, 0, 0]
              };
              config.components.push(component);
              if (
                "zeroedRotations" in componentRaw &&
                Array.isArray(componentRaw.zeroedRotations) &&
                componentRaw.zeroedRotations.every(
                  (rotation: any) =>
                    typeof rotation === "object" &&
                    "axis" in rotation &&
                    (rotation.axis === "x" || rotation.axis === "y" || rotation.axis === "z") &&
                    "degrees" in rotation &&
                    typeof rotation.degrees === "number"
                )
              ) {
                component.zeroedRotations = componentRaw.zeroedRotations;
              }
              if (
                "zeroedPosition" in componentRaw &&
                checkArrayType(componentRaw.zeroedPosition, "number") &&
                componentRaw.zeroedPosition.length === 3
              ) {
                component.zeroedPosition = componentRaw.zeroedPosition;
              }
            });
          }
          if (
            config.name.length > 0 &&
            config.cameras.every((camera) => camera.name.length > 0) &&
            fs.existsSync(decodeURIComponent(config.path)) &&
            config.components.every((value, index) =>
              fs.existsSync(decodeURIComponent(config.path).slice(0, -4) + "_" + index.toString() + ".glb")
            )
          ) {
            assets.robots.push(config);
            assets.loadFailures.splice(assets.loadFailures.indexOf(object.name), 1);
          }
        } else if (isJoystick) {
          // ***** JOYSTICK *****
          let config: ConfigJoystick = {
            name: "",
            path: encodePath(path.join(parentFolder, object.name, "image.png")),
            components: []
          };
          if ("name" in configRaw && typeof configRaw.name === "string") {
            config.name = configRaw.name;
          }
          if ("components" in configRaw && Array.isArray(configRaw.components)) {
            configRaw.components.forEach((componentRaw: object) => {
              let isYellow = false;
              if ("isYellow" in componentRaw && typeof componentRaw.isYellow === "boolean") {
                isYellow = componentRaw.isYellow;
              }
              let centerPx: [number, number] = [0, 0];
              if (
                "centerPx" in componentRaw &&
                checkArrayType(componentRaw.centerPx, "number") &&
                (componentRaw.centerPx as number[]).length === 2
              ) {
                centerPx = componentRaw.centerPx as [number, number];
              }

              if ("type" in componentRaw && typeof componentRaw.type === "string") {
                switch (componentRaw.type) {
                  case "button":
                    let buttonComponent: ConfigJoystick_Button = {
                      type: "button",
                      isYellow: isYellow,
                      isEllipse: false,
                      centerPx: centerPx,
                      sizePx: [0, 0],
                      sourceIndex: -1
                    };
                    if ("isEllipse" in componentRaw && typeof componentRaw.isEllipse === "boolean") {
                      buttonComponent.isEllipse = componentRaw.isEllipse;
                    }
                    if (
                      "sizePx" in componentRaw &&
                      checkArrayType(componentRaw.sizePx, "number") &&
                      (componentRaw.sizePx as number[]).length === 2
                    ) {
                      buttonComponent.sizePx = componentRaw.sizePx as [number, number];
                    }
                    if ("sourceIndex" in componentRaw && typeof componentRaw.sourceIndex === "number") {
                      buttonComponent.sourceIndex = componentRaw.sourceIndex;
                    }
                    if (
                      "sourcePov" in componentRaw &&
                      typeof componentRaw.sourcePov === "string" &&
                      (componentRaw.sourcePov === "up" ||
                        componentRaw.sourcePov === "right" ||
                        componentRaw.sourcePov === "down" ||
                        componentRaw.sourcePov === "left")
                    ) {
                      buttonComponent.sourcePov = componentRaw.sourcePov;
                    }
                    config.components.push(buttonComponent);
                    break;

                  case "joystick":
                    let joystickComponent: ConfigJoystick_Joystick = {
                      type: "joystick",
                      isYellow: isYellow,
                      centerPx: centerPx,
                      radiusPx: 0,
                      xSourceIndex: -1,
                      xSourceInverted: false,
                      ySourceIndex: -1,
                      ySourceInverted: false
                    };
                    if ("radiusPx" in componentRaw && typeof componentRaw.radiusPx === "number") {
                      joystickComponent.radiusPx = componentRaw.radiusPx;
                    }
                    if ("xSourceIndex" in componentRaw && typeof componentRaw.xSourceIndex === "number") {
                      joystickComponent.xSourceIndex = componentRaw.xSourceIndex;
                    }
                    if ("xSourceInverted" in componentRaw && typeof componentRaw.xSourceInverted === "boolean") {
                      joystickComponent.xSourceInverted = componentRaw.xSourceInverted;
                    }
                    if ("ySourceIndex" in componentRaw && typeof componentRaw.ySourceIndex === "number") {
                      joystickComponent.ySourceIndex = componentRaw.ySourceIndex;
                    }
                    if ("ySourceInverted" in componentRaw && typeof componentRaw.ySourceInverted === "boolean") {
                      joystickComponent.ySourceInverted = componentRaw.ySourceInverted;
                    }
                    if ("buttonSourceIndex" in componentRaw && typeof componentRaw.buttonSourceIndex === "number") {
                      joystickComponent.buttonSourceIndex = componentRaw.buttonSourceIndex;
                    }
                    config.components.push(joystickComponent);
                    break;

                  case "axis":
                    let axisComponent: ConfigJoystick_Axis = {
                      type: "axis",
                      isYellow: isYellow,
                      centerPx: centerPx,
                      sizePx: [0, 0],
                      sourceIndex: -1,
                      sourceRange: [-1, 1]
                    };
                    if (
                      "sizePx" in componentRaw &&
                      checkArrayType(componentRaw.sizePx, "number") &&
                      (componentRaw.sizePx as number[]).length === 2
                    ) {
                      axisComponent.sizePx = componentRaw.sizePx as [number, number];
                    }
                    if ("sourceIndex" in componentRaw && typeof componentRaw.sourceIndex === "number") {
                      axisComponent.sourceIndex = componentRaw.sourceIndex;
                    }
                    if (
                      "sourceRange" in componentRaw &&
                      checkArrayType(componentRaw.sourceRange, "number") &&
                      (componentRaw.sourceRange as number[]).length === 2
                    ) {
                      axisComponent.sourceRange = componentRaw.sourceRange as [number, number];
                    }
                    config.components.push(axisComponent);
                    break;
                }
              }
            });
          }
          if (
            config.name.length > 0 &&
            config.components.every((component) => {
              switch (component.type) {
                case "button":
                  return component.sizePx[0] > 0 && component.sizePx[1] > 0 && component.sourceIndex >= 0;
                case "joystick":
                  return component.radiusPx > 0 && component.xSourceIndex >= 0 && component.ySourceIndex >= 0;
                case "axis":
                  return component.sizePx[0] > 0 && component.sizePx[1] > 0 && component.sourceIndex >= 0;
              }
            }) &&
            fs.existsSync(decodeURIComponent(config.path))
          ) {
            assets.joysticks.push(config);
            assets.loadFailures.splice(assets.loadFailures.indexOf(object.name), 1);
          }
        }
      });
  });

  // Remove duplicate names
  let uniqueAssets: AdvantageScopeAssets = {
    field2ds: [],
    field3ds: [],
    robots: [],
    joysticks: [],
    loadFailures: assets.loadFailures
  };
  assets.field2ds.forEach((asset) => {
    if (uniqueAssets.field2ds.find((other) => other.name === asset.name) === undefined) {
      uniqueAssets.field2ds.push(asset);
    }
  });
  assets.field3ds.forEach((asset) => {
    if (uniqueAssets.field3ds.find((other) => other.name === asset.name) === undefined) {
      uniqueAssets.field3ds.push(asset);
    }
  });
  assets.robots.forEach((asset) => {
    if (uniqueAssets.robots.find((other) => other.name === asset.name) === undefined) {
      uniqueAssets.robots.push(asset);
    }
  });
  assets.joysticks.forEach((asset) => {
    if (uniqueAssets.joysticks.find((other) => other.name === asset.name) === undefined) {
      uniqueAssets.joysticks.push(asset);
    }
  });
  assets = uniqueAssets;

  // Sort assets
  {
    // Evergeen field in asset files, sort to end of list
    assets.field2ds.sort((a, b) => {
      if (a.name === "Evergreen") return 1;
      if (b.name === "Evergreen") return -1;
      return a.name > b.name ? -1 : b.name > a.name ? 1 : 0;
    });

    // Built-in fields added in code to end of list
    assets.field3ds.sort((a, b) => (a.name > b.name ? -1 : b.name > a.name ? 1 : 0));

    // All robots in asset files, no special sorting required
    assets.robots.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    // Built-in joysticks added in code to beginning of list
    assets.joysticks.sort((a, b) => (a.name > b.name ? -1 : b.name > a.name ? 1 : 0));

    // Sort load failures normally
    assets.loadFailures.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
  return assets;
}

/**
 * Encodes a path with special characters.
 */
function encodePath(pathStr: string): string {
  return pathStr
    .split(path.sep)
    .map((component, index) => {
      if (index === 0 && component.endsWith(":")) {
        // Windows drive letter
        return component;
      } else {
        return encodeURIComponent(component);
      }
    })
    .join(path.sep);
}
