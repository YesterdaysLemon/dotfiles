"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.devboxReopen = void 0;
const vscode_1 = require("vscode");
const promises_1 = require("fs/promises");
const node_child_process_1 = require("node:child_process");
const appNameBinaryMap = {
    "vscodium": "codium",
    // eslint-disable-next-line @typescript-eslint/naming-convention
    "visual studio code": "code",
    "cursor": "cursor",
};
async function devboxReopen() {
    if (process.platform === 'win32') {
        const seeDocs = 'See Devbox docs';
        const result = await vscode_1.window.showErrorMessage('This feature is not supported on your platform. \
      Please open VSCode from inside devbox shell in WSL using the CLI.', seeDocs);
        if (result === seeDocs) {
            vscode_1.env.openExternal(vscode_1.Uri.parse('https://www.jetify.com/devbox/docs/ide_configuration/vscode/#windows-setup'));
            return;
        }
    }
    await vscode_1.window.withProgress({
        location: vscode_1.ProgressLocation.Notification,
        title: "Setting up your Devbox environment. Please don't close vscode.",
        cancellable: true
    }, async (progress, token) => {
        token.onCancellationRequested(() => {
            console.log("User canceled the long running operation");
        });
        const p = new Promise(async (resolve, reject) => {
            if (vscode_1.workspace.workspaceFolders) {
                const workingDir = vscode_1.workspace.workspaceFolders[0].uri;
                const dotdevbox = vscode_1.Uri.joinPath(workingDir, '/.devbox');
                await logToFile(dotdevbox, 'Installing devbox packages');
                progress.report({ message: 'Installing devbox packages...', increment: 25 });
                await setupDotDevbox(workingDir, dotdevbox);
                // setup required vscode settings
                await logToFile(dotdevbox, 'Updating editor configurations');
                progress.report({ message: 'Updating configurations...', increment: 50 });
                updateVSCodeConf();
                // Calling CLI to compute devbox env
                await logToFile(dotdevbox, 'Calling "devbox integrate" to setup environment');
                progress.report({ message: 'Calling Devbox to setup environment...', increment: 80 });
                // To use a custom compiled devbox when testing, change this to an absolute path.
                const devbox = 'devbox';
                // run devbox integrate and then close this window
                const debugModeFlag = vscode_1.workspace.getConfiguration("devbox").get("enableDebugMode");
                // name of the currently open editor
                const ideName = appNameBinaryMap[vscode_1.env.appName.toLocaleLowerCase()] || 'code';
                let child = (0, node_child_process_1.spawn)(devbox, ['integrate', 'vscode', '--debugmode=' + debugModeFlag, '--ide=' + ideName], {
                    cwd: workingDir.path,
                    stdio: [0, 1, 2, 'ipc']
                });
                // if CLI closes before sending "finished" message
                child.on('close', (code) => {
                    console.log("child process closed with exit code:", code);
                    logToFile(dotdevbox, 'child process closed with exit code: ' + code);
                    vscode_1.window.showErrorMessage("Failed to setup devbox environment.");
                    reject();
                });
                // send config path to CLI
                child.send({ configDir: workingDir.path });
                // handle CLI finishing the env and sending  "finished"
                child.on('message', function (msg, handle) {
                    if (msg.status === "finished") {
                        progress.report({ message: 'Finished setting up! Reloading the window...', increment: 100 });
                        resolve();
                        vscode_1.commands.executeCommand("workbench.action.closeWindow");
                    }
                    else {
                        console.log(msg);
                        logToFile(dotdevbox, 'Failed to setup devbox environment.' + String(msg));
                        vscode_1.window.showErrorMessage("Failed to setup devbox environment.");
                        reject();
                    }
                });
            }
        });
        return p;
    });
}
exports.devboxReopen = devboxReopen;
async function setupDotDevbox(workingDir, dotdevbox) {
    try {
        // check if .devbox exists
        await vscode_1.workspace.fs.stat(dotdevbox);
    }
    catch (error) {
        //.devbox doesn't exist
        // running devbox shellenv to create it
        (0, node_child_process_1.spawnSync)('devbox', ['shellenv'], {
            cwd: workingDir.path
        });
    }
}
function updateVSCodeConf() {
    if (process.platform === 'darwin') {
        const shell = process.env["SHELL"] ?? "/bin/zsh";
        const shellArgsMap = (shellType) => {
            switch (shellType) {
                case "fish":
                    // We special case fish here because fish's `fish_add_path` function
                    // tends to prepend to PATH by default, hence sourcing the fish config after
                    // vscode reopens in devbox environment, overwrites devbox packages and 
                    // might cause confusion for users as to why their system installed packages
                    // show up when they type for example `which go` as opposed to the packages
                    // installed by devbox.
                    return ["--no-config"];
                default:
                    return [];
            }
        };
        const shellTypeSlices = shell.split("/");
        const shellType = shellTypeSlices[shellTypeSlices.length - 1];
        shellArgsMap(shellType);
        const devboxCompatibleShell = {
            "devboxCompatibleShell": {
                "path": shell,
                "args": shellArgsMap(shellType)
            }
        };
        vscode_1.workspace.getConfiguration().update('terminal.integrated.profiles.osx', devboxCompatibleShell, vscode_1.ConfigurationTarget.Workspace);
        vscode_1.workspace.getConfiguration().update('terminal.integrated.defaultProfile.osx', 'devboxCompatibleShell', vscode_1.ConfigurationTarget.Workspace);
    }
}
async function logToFile(dotDevboxPath, message) {
    // only print to log file if debug mode config is set to true
    if (vscode_1.workspace.getConfiguration("devbox").get("enableDebugMode")) {
        try {
            const logFilePath = vscode_1.Uri.joinPath(dotDevboxPath, 'extension.log');
            const timestamp = new Date().toUTCString();
            const fileHandler = await (0, promises_1.open)(logFilePath.fsPath, 'a');
            const logData = new Uint8Array(Buffer.from(`[${timestamp}] ${message}\n`));
            await (0, promises_1.writeFile)(fileHandler, logData, { flag: 'a' });
            await fileHandler.close();
        }
        catch (error) {
            console.log("failed to write to extension.log file");
            console.error(error);
        }
    }
}
//# sourceMappingURL=devbox.js.map