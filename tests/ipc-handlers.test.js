const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

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

    // Neutral mock (no out-of-scope captures)
    jest.mock('electron', () => ({
      ipcMain: { handle: jest.fn() },
      dialog: { showOpenDialog: jest.fn() },
      app: { getPath: jest.fn() },
    }));

    const electron = require('electron');

    // Assign implementations after mock creation
    electron.app.getPath.mockReturnValue(tmpUserData);
    electron.dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [path.join(tmpUserData, 'input.txt')],
    });

    // Mock dbManager used by ipc handlers
    dbManager = {
      getUserByUsername: jest.fn(async (u) => ({ id: 'local-admin', username: u, role: 'admin' })),
      verifyPassword: jest.fn(async () => true),
      logAction: jest.fn(async () => {}),
      addFile: jest.fn(async () => {}),
      getFiles: jest.fn(async () => [{ id: 'file-1' }]),
    };

    // Mock sequence for /login, /files/upload-url, PUT, /files/metadata
    fetchMock = jest.fn()
      // /login
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({ token: 'jwt-token-123', user: { id: 'u1', role: 'user', username: 'admin' } }),
      }))
      // /files/upload-url
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({ signedUrl: 'https://signed.example/put', path: 'u1/some.enc' }),
      }))
      // PUT to signed URL
      .mockImplementationOnce(async () => ({ ok: true }))
      // /files/metadata
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
  });

  afterEach(() => {
    try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) {}
    delete global.fetch;
  });

  test('login stores JWT and file:add sends Authorization header and posts metadata', async () => {
    // Call user:login
    const loginResult = await handlers['user:login']({}, { username: 'admin', password: 'password' });
    expect(loginResult).toHaveProperty('token', 'jwt-token-123');

    // Call file:add; password used for encryption
    const addResult = await handlers['file:add']({}, { password: 'password' });
    expect(addResult.success).toBe(true);
    expect(dbManager.addFile).toHaveBeenCalled();

    // Assert Authorization header was sent to upload-url and metadata
    const calls = fetchMock.mock.calls;
    const uploadUrlCall = calls[1];
    const metadataCall = calls[3];

    expect(uploadUrlCall[0]).toMatch(/\/files\/upload-url$/);
    expect(uploadUrlCall[1].headers.Authorization).toBe('Bearer jwt-token-123');
    expect(metadataCall[0]).toMatch(/\/files\/metadata$/);
    expect(metadataCall[1].headers.Authorization).toBe('Bearer jwt-token-123');
  });
});