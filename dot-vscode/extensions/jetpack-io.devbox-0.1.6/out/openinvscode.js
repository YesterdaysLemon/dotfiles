"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleOpenInVSCode = void 0;
const os = require("os");
const which = require("which");
const node_fetch_1 = require("node-fetch");
const child_process_1 = require("child_process");
const FormData = require("form-data");
const vscode_1 = require("vscode");
const promises_1 = require("fs/promises");
async function handleOpenInVSCode(uri) {
    const queryParams = new URLSearchParams(uri.query);
    if (queryParams.has('vm_id') && queryParams.has('token')) {
        //Not yet supported for windows + WSL - will be added in future
        if (os.platform() !== 'win32') {
            vscode_1.window.showInformationMessage('Setting up devbox');
            // getting ssh keys
            try {
                console.debug('Calling getVMInfo...');
                const response = await getVMInfo(queryParams.get('token'), queryParams.get('vm_id'));
                const res = await response.json();
                console.debug('getVMInfo response: ' + res);
                // set ssh config
                console.debug('Calling setupSSHConfig...');
                await setupSSHConfig(res.vm_id, res.private_key);
                // connect to remote vm
                console.debug('Calling connectToRemote...');
                connectToRemote(res.username, res.vm_id, res.working_directory);
            }
            catch (err) {
                console.error(err);
                vscode_1.window.showInformationMessage('Failed to setup devbox remote connection.');
            }
        }
        else {
            vscode_1.window.showErrorMessage('This function is not yet supported in Windows operating system.');
        }
    }
    else {
        vscode_1.window.showErrorMessage('Error parsing information for remote environment.');
        console.debug(queryParams.toString());
    }
    ;
}
exports.handleOpenInVSCode = handleOpenInVSCode;
async function getVMInfo(token, vmId) {
    // send post request to gateway to get vm info and ssh keys
    const gatewayHost = 'https://api.devbox.sh/g/vm_info';
    const data = new FormData();
    data.append("vm_id", vmId);
    console.debug("calling devbox to get vm_info...");
    const response = await (0, node_fetch_1.default)(gatewayHost, {
        method: 'post',
        body: data,
        headers: {
            authorization: `Bearer ${token}`
        }
    });
    console.debug("API Call to api.devbox.sh response: " + response);
    return response;
}
async function setupDevboxLauncher() {
    // download devbox launcher script
    const gatewayHost = 'https://releases.jetify.com/devbox';
    const response = await (0, node_fetch_1.default)(gatewayHost, {
        method: 'get',
    });
    const launcherPath = `${process.env['HOME']}/.config/devbox/launcher.sh`;
    try {
        const launcherScript = await response.text();
        const launcherData = new Uint8Array(Buffer.from(launcherScript));
        const fileHandler = await (0, promises_1.open)(launcherPath, 'w');
        await (0, promises_1.writeFile)(fileHandler, launcherData, { flag: 'w' });
        await (0, promises_1.chmod)(launcherPath, 0o711);
        await fileHandler.close();
    }
    catch (err) {
        console.error("error setting up launcher script" + err);
        throw (err);
    }
    return launcherPath;
}
async function setupSSHConfig(vmId, prKey) {
    const devboxBinary = await which('devbox', { nothrow: true });
    let devboxPath = 'devbox';
    if (devboxBinary === null) {
        devboxPath = await setupDevboxLauncher();
    }
    // For testing change devbox to path to a compiled devbox binary or add --config
    (0, child_process_1.exec)(`${devboxPath} generate ssh-config`, (error, stdout, stderr) => {
        if (error) {
            vscode_1.window.showErrorMessage('Failed to setup ssh config. Run VSCode in debug mode to see logs.');
            console.error(`Failed to setup ssh config: ${error}`);
            return;
        }
        console.debug(`stdout: ${stdout}`);
        console.debug(`stderr: ${stderr}`);
    });
    // save private key to file
    const prkeyDir = `${process.env['HOME']}/.config/devbox/ssh/keys`;
    await ensureDir(prkeyDir);
    const prkeyPath = `${prkeyDir}/${vmId}.vm.devbox-vms.internal`;
    try {
        const prKeydata = new Uint8Array(Buffer.from(prKey));
        const fileHandler = await (0, promises_1.open)(prkeyPath, 'w');
        await (0, promises_1.writeFile)(fileHandler, prKeydata, { flag: 'w' });
        await (0, promises_1.chmod)(prkeyPath, 0o600);
        await fileHandler.close();
    }
    catch (err) {
        // When a request is aborted - err is an AbortError
        console.error('Failed to setup ssh config: ' + err);
        throw (err);
    }
}
function connectToRemote(username, vmId, workDir) {
    try {
        const host = `${username}@${vmId}.vm.devbox-vms.internal`;
        const workspaceURI = `vscode-remote://ssh-remote+${host}${workDir}`;
        const uriToOpen = vscode_1.Uri.parse(workspaceURI);
        console.debug("uriToOpen: ", uriToOpen.toString());
        vscode_1.commands.executeCommand("vscode.openFolder", uriToOpen, false);
    }
    catch (err) {
        console.error('failed to connect to remote: ' + err);
    }
}
async function ensureDir(dir) {
    try {
        await (0, promises_1.mkdir)(dir, { recursive: true, mode: 0o700 });
    }
    catch (err) {
        if (err.code !== 'EEXIST') {
            console.error('Failed to setup ssh keys directory: ' + err);
            throw (err);
        }
    }
}
//# sourceMappingURL=openinvscode.js.map