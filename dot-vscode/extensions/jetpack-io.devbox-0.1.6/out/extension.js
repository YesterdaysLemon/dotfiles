"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
// The module 'vscode' contains the VS Code extensibility API
const vscode_1 = require("vscode");
const path_1 = require("path");
const openinvscode_1 = require("./openinvscode");
const devbox_1 = require("./devbox");
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
function activate(context) {
    // This line of code will only be executed once when your extension is activated
    initialCheckDevboxJSON(context);
    // Creating file watchers to watch for events on devbox.json
    const fswatcher = vscode_1.workspace.createFileSystemWatcher("**/devbox.json", false, false, false);
    fswatcher.onDidDelete(e => {
        vscode_1.commands.executeCommand('setContext', 'devbox.configFileExists', false);
        context.workspaceState.update("configFileExists", false);
    });
    fswatcher.onDidCreate(e => {
        vscode_1.commands.executeCommand('setContext', 'devbox.configFileExists', true);
        context.workspaceState.update("configFileExists", true);
    });
    fswatcher.onDidChange(e => initialCheckDevboxJSON(context));
    // Check for devbox.json when a new folder is opened
    vscode_1.workspace.onDidChangeWorkspaceFolders(async (e) => initialCheckDevboxJSON(context));
    // run devbox shell when terminal is opened
    vscode_1.window.onDidOpenTerminal(async (e) => {
        if (vscode_1.workspace.getConfiguration("devbox").get("autoShellOnTerminal")
            && e.name !== "DevboxTerminal"
            && context.workspaceState.get("configFileExists")) {
            await runInTerminal('devbox shell', true);
        }
    });
    // open in vscode URI handler
    const handleVSCodeUri = vscode_1.window.registerUriHandler({ handleUri: openinvscode_1.handleOpenInVSCode });
    const devboxAdd = vscode_1.commands.registerCommand('devbox.add', async () => {
        const result = await vscode_1.window.showInputBox({
            value: '',
            placeHolder: 'Package to add to devbox. E.g., python39',
        });
        await runInTerminal(`devbox add ${result}`, false);
    });
    const devboxRun = vscode_1.commands.registerCommand('devbox.run', async () => {
        const items = await getDevboxScripts();
        if (items.length > 0) {
            const result = await vscode_1.window.showQuickPick(items);
            await runInTerminal(`devbox run ${result}`, true);
        }
        else {
            vscode_1.window.showInformationMessage("No scripts found in devbox.json");
        }
    });
    const devboxShell = vscode_1.commands.registerCommand('devbox.shell', async () => {
        // todo: add support for --config path to devbox.json
        await runInTerminal('devbox shell', true);
    });
    const devboxRemove = vscode_1.commands.registerCommand('devbox.remove', async () => {
        const items = await getDevboxPackages();
        if (items.length > 0) {
            const result = await vscode_1.window.showQuickPick(items);
            await runInTerminal(`devbox rm ${result}`, false);
        }
        else {
            vscode_1.window.showInformationMessage("No packages found in devbox.json");
        }
    });
    const devboxInit = vscode_1.commands.registerCommand('devbox.init', async () => {
        await runInTerminal('devbox init', false);
        vscode_1.commands.executeCommand('setContext', 'devbox.configFileExists', true);
    });
    const devboxInstall = vscode_1.commands.registerCommand('devbox.install', async () => {
        await runInTerminal('devbox install', true);
    });
    const devboxUpdate = vscode_1.commands.registerCommand('devbox.update', async () => {
        await runInTerminal('devbox update', true);
    });
    const devboxSearch = vscode_1.commands.registerCommand('devbox.search', async () => {
        const result = await vscode_1.window.showInputBox({ placeHolder: "Name or a subset of a name of a package to search" });
        await runInTerminal(`devbox search ${result}`, true);
    });
    const setupDevcontainer = vscode_1.commands.registerCommand('devbox.setupDevContainer', async () => {
        await runInTerminal('devbox generate devcontainer', true);
    });
    const generateDockerfile = vscode_1.commands.registerCommand('devbox.generateDockerfile', async () => {
        await runInTerminal('devbox generate dockerfile', true);
    });
    const reopen = vscode_1.commands.registerCommand('devbox.reopen', async () => {
        await (0, devbox_1.devboxReopen)();
    });
    context.subscriptions.push(reopen);
    context.subscriptions.push(devboxAdd);
    context.subscriptions.push(devboxRun);
    context.subscriptions.push(devboxInit);
    context.subscriptions.push(devboxInstall);
    context.subscriptions.push(devboxSearch);
    context.subscriptions.push(devboxUpdate);
    context.subscriptions.push(devboxRemove);
    context.subscriptions.push(devboxShell);
    context.subscriptions.push(setupDevcontainer);
    context.subscriptions.push(generateDockerfile);
    context.subscriptions.push(handleVSCodeUri);
}
exports.activate = activate;
async function initialCheckDevboxJSON(context) {
    // check if there is a workspace folder open
    if (vscode_1.workspace.workspaceFolders) {
        const workspaceUri = vscode_1.workspace.workspaceFolders[0].uri;
        try {
            // check if the folder has devbox.json in it
            await vscode_1.workspace.fs.stat(vscode_1.Uri.joinPath(workspaceUri, "devbox.json"));
            // devbox.json exists setcontext for devbox commands to be available
            vscode_1.commands.executeCommand('setContext', 'devbox.configFileExists', true);
            context.workspaceState.update("configFileExists", true);
        }
        catch (err) {
            console.log(err);
            // devbox.json does not exist
            vscode_1.commands.executeCommand('setContext', 'devbox.configFileExists', false);
            context.workspaceState.update("configFileExists", false);
            console.log("devbox.json does not exist");
        }
    }
}
async function runInTerminal(cmd, showTerminal) {
    // check if a terminal is open
    if (vscode_1.window.terminals.length === 0) {
        const terminalName = 'DevboxTerminal';
        const terminal = vscode_1.window.createTerminal({ name: terminalName });
        if (showTerminal) {
            terminal.show();
        }
        terminal.sendText(cmd, true);
    }
    else {
        // A terminal is open
        // run the given cmd in terminal
        await vscode_1.commands.executeCommand('workbench.action.terminal.sendSequence', {
            'text': `${cmd}\r\n`
        });
    }
}
async function getDevboxScripts() {
    try {
        if (!vscode_1.workspace.workspaceFolders) {
            vscode_1.window.showInformationMessage('No folder or workspace opened');
            return [];
        }
        const workspaceUri = vscode_1.workspace.workspaceFolders[0].uri;
        const devboxJson = await readDevboxJson(workspaceUri);
        return Object.keys(devboxJson['shell']['scripts']);
    }
    catch (error) {
        console.error('Error processing devbox.json - ', error);
        return [];
    }
}
async function getDevboxPackages() {
    try {
        if (!vscode_1.workspace.workspaceFolders) {
            vscode_1.window.showInformationMessage('No folder or workspace opened');
            return [];
        }
        const workspaceUri = vscode_1.workspace.workspaceFolders[0].uri;
        const devboxJson = await readDevboxJson(workspaceUri);
        return devboxJson['packages'];
    }
    catch (error) {
        console.error('Error processing devbox.json - ', error);
        return [];
    }
}
async function readDevboxJson(workspaceUri) {
    const fileUri = workspaceUri.with({ path: path_1.posix.join(workspaceUri.path, 'devbox.json') });
    const readData = await vscode_1.workspace.fs.readFile(fileUri);
    const readStr = Buffer.from(readData).toString('utf8');
    const devboxJsonData = JSON.parse(readStr);
    return devboxJsonData;
}
// This method is called when your extension is deactivated
function deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map