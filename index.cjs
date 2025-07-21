const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const chalk = require("chalk");
const gradient = require("gradient-string");
const cliProgress = require("cli-progress");
const prompts = require("prompts");
const { exec } = require("child_process");
const crypto = require("crypto");

const SELF_REPO = "https://github.com/itzdaimy/Download-Manager/main";
const FILES_TO_CHECK = ["index.js", "available.json"];

async function start() {
  await selfUpdate()
  await mainMenu()
}

async function fileHash(filePath) {
  if (!fs.existsSync(filePath)) return "";
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function urlHash(url) {
  try {
    const res = await axios.get(url, { responseType: "arraybuffer" });
    return crypto.createHash("sha256").update(res.data).digest("hex");
  } catch {
    return "";
  }
}

async function selfUpdate() {
  let updated = false;

  for (const file of FILES_TO_CHECK) {
    const localPath = path.join(__dirname, file);
    const remoteURL = `${SELF_REPO}/${file}`;

    const [local, remote] = await Promise.all([
      fileHash(localPath),
      urlHash(remoteURL)
    ]);

    if (local !== remote && remote) {
      const res = await axios.get(remoteURL, { responseType: "arraybuffer" });
      fs.writeFileSync(localPath, Buffer.from(res.data));
      console.log(`✅ Updated ${file}`);
      updated = true;
    }
  }

  if (updated) {
    console.log("\n🔁 Restarting to apply updates...");
    setTimeout(() => {
      require("child_process").spawn("node", [__filename], {
        stdio: "inherit"
      });
      process.exit(0);
    }, 1000);
  }
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
      await fs.remove(fullPath);
      console.log(chalk.redBright(`✘ Uninstalled ${item.name}`));
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
        { title: "Uninstall", value: "Uninstall" },
        { title: "Update", value: "Update" },
        { title: "Exit", value: "Exit" }
      ]
    });

    if (action === "Exit") {
      console.log(chalk.gray("👋 Goodbye!"));
      break;
    }

    const choices = data.map(item => {
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

    await prompts({
      type: "toggle",
      name: "cont",
      message: "Return to menu?",
      active: "Yes",
      inactive: "No",
      initial: true
    }).then(res => {
      if (!res.cont) process.exit(0);
    });
  }
}

start();
