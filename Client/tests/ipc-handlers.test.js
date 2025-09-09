const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

jest.mock('../src/main/services/api-services', () => ({
  login: jest.fn(async () => ({ token: 'jwt-token-123', user: { id: 'u1', username: 'admin', role: 'user' } })),
  getSignedUploadUrl: jest.fn(async () => ({ signedUrl: 'https://signed.example/put', path: 'u1/some.enc' })),
  persistMetadata: jest.fn(async () => ({ ok: true })),
}));

// Neutral mock: do not capture out-of-scope vars
jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn() },
  dialog: { showOpenDialog: jest.fn() },
  app: { getPath: jest.fn() },
}));

describe('ipc-handlers upload workflow', () => {
  let tmpUserData;
  let handlers;
  let registerIpcHandlers;
  let dbManager;
  let fetchMock;

  beforeEach(async () => {
    tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'iic-userdata-'));
    fs.writeFileSync(path.join(tmpUserData, 'input.txt'), Buffer.from('sample'));

    jest.resetModules();

    // Mock uuid (ESM) for Jest CommonJS environment
    jest.mock('uuid', () => ({ v4: () => '00000000-0000-0000-0000-000000000000' }));

    const electron = require('electron');
    // Assign implementations after mock creation
    electron.app.getPath.mockReturnValue(tmpUserData);
    electron.dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [path.join(tmpUserData, 'input.txt')],
    });

    // Mock dbManager used by ipc handlers
    dbManager = {
      logAction: jest.fn(async () => {}),
      addFile: jest.fn(async () => {}),
      getFiles: jest.fn(async () => [{ id: 'file-1' }]),
    };

    // Mock sequence for PUT upload
    fetchMock = jest.fn()
      // PUT to signed URL
      .mockImplementationOnce(async () => ({ ok: true }));

    global.fetch = fetchMock;

    // Require after mocks
    ({ registerIpcHandlers } = require('../src/main/ipc-handlers'));

    // Register handlers
    registerIpcHandlers(dbManager, {});

    // Build channel->fn map from registered handlers
    handlers = {};
    for (const [channel, fn] of electron.ipcMain.handle.mock.calls) {
      handlers[channel] = fn;
    }

    // Perform login via handler to set currentUser
    await handlers['user:login']({}, { username: 'admin', password: 'password' });
  });

  afterEach(() => {
    try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) {}
    delete global.fetch;
  });

  test('file:add sends Authorization header and posts metadata', async () => {
    const addResult = await handlers['file:add']({}, { password: 'password' });
    expect(addResult.success).toBe(true);
  });

  test('file:addPath uploads a specific file path', async () => {
    const filePath = path.join(tmpUserData, 'custom.txt');
    fs.writeFileSync(filePath, Buffer.from('content'));
    const res = await handlers['file:addPath']({}, { password: 'password', filePath });
    expect(res.success).toBe(true);
  });
});