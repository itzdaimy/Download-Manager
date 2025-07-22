const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const chalk = require("chalk");
const gradient = require("gradient-string");
const cliProgress = require("cli-progress");
const prompts = require("prompts");
const { exec, spawn } = require("child_process");
const crypto = require("crypto");

async function start() {
  await mainMenu()
}

const availablePath = path.join(__dirname, "available.json");

function logHeader() {
  console.clear();
  console.log(gradient.pastel.multiline(`
╔════════════════════════════════════════════╗
║          Daimy's Download Manager          ║
╚════════════════════════════════════════════╝
`));
}

async function fetchRepoFiles(repo, branch = "main") {
  const apiUrl = `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`;
  const response = await axios.get(apiUrl);
  return response.data.tree.filter(file => file.type === "blob");
}

async function downloadFile(repo, branch, filePath, destPath, retries = 3) {
  const url = `https://raw.githubusercontent.com/${repo}/${branch}/${filePath}`;
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await axios.get(url, { responseType: "arraybuffer" });
      await fs.ensureDir(path.dirname(destPath));
      await fs.writeFile(destPath, response.data);
      return;
    } catch {
      if (i === retries) throw new Error("Retry limit reached.");
      await new Promise(res => setTimeout(res, 1000));
    }
  }
}

async function installDependencies(folder) {
  const pkgPath = path.join(folder, "package.json");
  if (fs.existsSync(pkgPath)) {
    console.log(chalk.yellow("📦 Detected package.json — running npm install..."));
    return new Promise((resolve) => {
      exec(`cd "${folder}" && npm install`, (err) => {
        if (err) {
          console.log(chalk.red("npm install failed."));
        } else {
          console.log(chalk.green("✔ npm install complete."));
        }
        resolve();
      });
    });
  }
}

async function handleDownload(item) {
  const { name, repo, branch = "main", folder } = item;
  const targetFolder = path.join(__dirname, folder);

  if (fs.existsSync(targetFolder)) {
    const { overwrite } = await prompts({
      type: "confirm",
      name: "overwrite",
      message: `${name} already exists. Overwrite?`,
      initial: false
    });
    if (!overwrite) return;
    await fs.remove(targetFolder);
  }

  console.log(chalk.cyanBright(`🔽 Downloading ${name}...`));
  try {
    const files = await fetchRepoFiles(repo, branch);
    const bar = new cliProgress.SingleBar({
      format: `${chalk.greenBright("{bar}")} {percentage}% | {value}/{total}`,
      barCompleteChar: "█", barIncompleteChar: "░"
    });
    bar.start(files.length, 0);

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const localPath = path.join(targetFolder, f.path);
      await downloadFile(repo, branch, f.path, localPath);
      bar.update(i + 1);
    }

    bar.stop();
    console.log(chalk.green(`✔ Downloaded to ${folder}\n`));
    await installDependencies(targetFolder);
  } catch (err) {
    console.log(chalk.red(`✘ Error downloading ${name}: ${err.message}`));
  }
}

async function removeWithRetries(folder, retries = 5, delayMs = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      await fs.remove(folder);
      return;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(res => setTimeout(res, delayMs));
    }
  }
}

async function handleUninstall(item) {
  const fullPath = path.join(__dirname, item.folder);
  if (fs.existsSync(fullPath)) {
    const { confirm } = await prompts({
      type: "confirm",
      name: "confirm",
      message: `Are you sure you want to uninstall ${item.name}?`,
      initial: true
    });
    if (confirm) {
      try {
        await removeWithRetries(fullPath);
        console.log(chalk.redBright(`✘ Uninstalled ${item.name}`));
      } catch (err) {
        console.log(chalk.red(`Failed to uninstall ${item.name}: ${err.message}`));
      }
    }
  } else {
    console.log(chalk.gray("Nothing to uninstall."));
  }
}

async function handleUpdate(item) {
  console.log(chalk.blueBright(`🔁 Updating ${item.name}...`));
  await handleUninstall(item);
  await handleDownload(item);
}

async function startRepo(item) {
  const repoFolder = path.join(__dirname, item.folder);
  if (!fs.existsSync(repoFolder)) {
    console.log(chalk.red(`${item.name} is not installed.`));
    return;
  }
  const startFile = item.startFile || "index.js";
  const startPath = path.join(repoFolder, startFile);
  if (!fs.existsSync(startPath)) {
    console.log(chalk.red(`Start file ${startFile} not found in ${item.name}.`));
    return;
  }
  console.log(chalk.cyanBright(`🚀 Launching new terminal for ${item.name}...`));
  const cmd = `start cmd /k node "${startPath}"`;
  exec(cmd, { cwd: repoFolder });
}

async function mainMenu() {
  while (true) {
    logHeader();
    if (!fs.existsSync(availablePath)) {
      console.log(chalk.red("available.json not found"));
      return;
    }
    const data = JSON.parse(fs.readFileSync(availablePath, "utf8"));
    const { action } = await prompts({
      type: "select",
      name: "action",
      message: "What do you want to do?",
      choices: [
        { title: "Download", value: "Download" },
        { title: "Start", value: "Start" },
        { title: "Uninstall", value: "Uninstall" },
        { title: "Update", value: "Update" },
        { title: "Exit", value: "Exit" }
      ]
    });
    if (action === "Exit") {
      console.log(chalk.gray("👋 Goodbye!"));
      break;
    }
    let filteredData = data;
    if (["Start", "Uninstall", "Update"].includes(action)) {
      filteredData = data.filter(item => fs.existsSync(path.join(__dirname, item.folder)));
      if (filteredData.length === 0) {
        console.log(chalk.yellow(`\nNo installed repos available for ${action.toLowerCase()}.\n`));
        await new Promise(res => setTimeout(res, 1500));
        continue;
      }
    }
    const choices = filteredData.map(item => {
      const installed = fs.existsSync(path.join(__dirname, item.folder));
      return {
        title: `${item.name}${installed ? chalk.green(" [Installed]") : ""}`,
        value: item
      };
    });
    const { selected } = await prompts({
      type: "select",
      name: "selected",
      message: `Select a repo to ${action.toLowerCase()}:`,
      choices
    });
    if (!selected) continue;
    if (action === "Download") await handleDownload(selected);
    if (action === "Uninstall") await handleUninstall(selected);
    if (action === "Update") await handleUpdate(selected);
    if (action === "Start") await startRepo(selected);
    const { cont } = await prompts({
      type: "toggle",
      name: "cont",
      message: "Return to menu?",
      active: "Yes",
      inactive: "No",
      initial: true
    });
    if (!cont) process.exit(0);
  }
}

start();
