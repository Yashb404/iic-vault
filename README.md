# Secure Data Vault

A cross-platform desktop application providing end-to-end encrypted file storage with multi-device synchronization capabilities. Built with Electron and Node.js, this application implements a zero-knowledge architecture where the server cannot access user data.


# ⚠️ Deployment Note for Judges

### This project is a cross-platform desktop application built with Electron.
### By design, the client application is not deployed on a server — it runs locally on user machines (Windows, macOS, Linux).

For full functionality, the project also requires a backend server that handles authentication, metadata, and file synchronization. During the hackathon we implemented this local server (https://github.com/Yashb404/server) in Node.js/Express, but we did not deploy it to a public cloud due to time constraints.


👉 To make the project fully operational, the following deployment steps are needed:

Server Deployment
`
Host the Node.js/Express API server on a cloud provider (e.g. Render, Vercel, AWS, Heroku).->
Connect it to a managed PostgreSQL database (we used NeonDB in development).->
Configure environment variables (DATABASE_URL, JWT_SECRET, S3 credentials).->
Enable HTTPS for secure communication.->
Storage Setup->
Provision an S3-compatible bucket (Supabase Storage or AWS S3).->
Apply bucket policies so only signed URLs can be used for upload/download.->
Client Configuration->
In the Electron app, update .env → SECURE_VAULT_API_BASE to point to the deployed server’s URL.->
Distribute the packaged Electron app to users (Windows/macOS/Linux).
`
### Until the server is deployed, the desktop client still demonstrates some features locally

This is sufficient for hackathon judging, but the above steps are what’s needed to take the prototype into a production-ready system.

## Architecture Overview

The application follows a client-server architecture with the following components:

- **Client**: Electron-based desktop application handling encryption/decryption and local file management
- **Server**: Node.js/Express API server managing authentication and metadata storage
- **Storage**: AWS S3-compatible storage (Supabase) for encrypted file blobs
- **Database**: PostgreSQL (NeonDB) for metadata storage and SQLite for local caching

## Security Model

- **End-to-End Encryption**: Files are encrypted locally using AES-256-GCM before upload
- **Zero-Knowledge Server**: Server cannot decrypt or access user file contents
- **JWT Authentication**: Secure token-based authentication with configurable expiration
- **Isolated Storage**: User files are stored in isolated paths based on user ID
- **Local Caching**: Encrypted files cached locally for offline access

## Prerequisites

### Development Environment
- Node.js 18.0 or higher
- npm 8.0 or higher
- Git

### Required Services

#### AWS S3-Compatible Storage (Currently Required)
The application currently requires an AWS S3-compatible storage service for file storage. We are using Supabase Storage for this purpose.

**Required Environment Variables:**
```
AWS_S3_REGION=your-region
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_S3_BUCKET=your-bucket-name
```

#### Database Services
- **NeonDB**: PostgreSQL database for server-side metadata storage
- **Local SQLite**: Automatically created for client-side caching

**Required Environment Variables:**
```
DATABASE_URL=your-neondb-connection-string
JWT_SECRET=your-jwt-secret-key
```

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd Client
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
Create a `.env` file in the project root with the following variables:
```env
# Server Configuration
SECURE_VAULT_API_BASE=http://localhost:3001

# Database Configuration
DATABASE_URL=your-neondb-connection-string
JWT_SECRET=your-secure-jwt-secret

# AWS S3 Configuration (Supabase Storage)
AWS_S3_REGION=your-region
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_S3_BUCKET=your-bucket-name
```

## Running the Application

### Development Mode

1. Start the server (if running locally):
```bash
# Navigate to server directory and start
cd ../Server
npm run dev
```

2. Start the Electron application:
```bash
cd ../Client
npm start
```

### Production Build

1. Package the application:
```bash
npm run package
```

2. Create distributables:
```bash
npm run make
```

## Testing

Run the test suite:
```bash
npm test
```

The test suite includes:
- Unit tests for encryption/decryption functionality
- Database manager tests
- IPC handler tests
- Synchronization service tests
- Comprehensive integration tests

## Project Structure

```
src/
├── main/                    # Electron main process
│   ├── index.js            # Application entry point
│   ├── ipc-handlers.js     # IPC communication handlers
│   ├── preload.js          # Preload script for security
│   └── services/           # Core services
│       ├── api-services.js # Server API communication
│       ├── crypto-engine.js # Encryption/decryption
│       ├── database-manager.js # Local SQLite management
│       └── sync-service.js # Synchronization logic
├── renderer/               # Electron renderer process
│   ├── index.html         # Main UI
│   ├── renderer.js        # Frontend JavaScript
│   └── styles/
│       └── main.css       # Application styles
├── cli/                   # Command-line interface
│   └── vaultx.js         # CLI tool
└── shared/               # Shared utilities
    └── constants.js      # Application constants

tests/                     # Test files
├── crypto-engine.test.js
├── database-manager.test.js
├── ipc-handlers.test.js
├── sync-service.test.js
└── synchronization.test.js
```
# CLI Usage: `vaultx`

The `vaultx` CLI provides full access to the Secure Data Vault system from the command line. All features available in the Electron app are also available via CLI.

## Installation

You can run the CLI directly from the `src/cli/vaultx.js` file, or symlink it as `vaultx` in your PATH.

## Commands

### Remote API

```
vaultx remote login --username <user> --password <pass> [--api <url>]
vaultx remote logout
vaultx remote status
```
- `login`: Authenticate with the remote dashboard API and save a session token.
- `logout`: Clear the saved remote session.
- `status`: Show current remote session info.

### User Management

```
vaultx user add --username <user> --password <pass> [--role admin|user] [--db <dbfile>]
vaultx login --username <user> --password <pass> [--db <dbfile>]
```
- `user add`: Create a new user in the local database.
- `login`: Verify credentials for a user.

### File Operations

```
vaultx file upload --path <file> --owner <userId> --password <pw> [--out <dir>] [--remote] [--api <url>] [--db <dbfile>]
vaultx file download --fileId <id> --password <pw> --dest <output> [--src <encfile>] [--db <dbfile>]
vaultx file ls --user <userId> [--db <dbfile>]
```
- `upload`: Encrypt and register a file. Optionally upload to remote dashboard.
- `download`: Decrypt a file by fileId and password, saving to a destination.
- `ls`: List files accessible by a user.

### Permissions

```
vaultx perm grant --fileId <id> --userId <id> --perm read|write [--db <dbfile>]
vaultx perm revoke --fileId <id> --userId <id> --perm read|write [--db <dbfile>]
vaultx perm ls --fileId <id> [--db <dbfile>]
```
- `grant`: Grant read/write permission to a user for a file.
- `revoke`: Revoke permission from a user for a file.
- `ls`: List permissions for a file.

### Audit Logs

```
vaultx logs [--db <dbfile>]
```
- Show the latest audit logs.

### Sync

```
vaultx sync run --fileId <id> --dirs <dir1,dir2,...> [--db <dbfile>]
vaultx sync watch --dirs <dir1,dir2,...> [--db <dbfile>]
```
- `run`: Run on-demand sync for a file across directories.
- `watch`: Continuously watch directories and auto-sync on changes.

## Options

- `--db <dbfile>`: Use a custom database file (default: `~/.iic-vault/vault.db`).
- `--api <url>`: Override the remote API base URL for remote operations.

## Examples

```
# Add a user
vaultx user add --username alice --password secret --role user

# Login
vaultx login --username alice --password secret

# Upload a file (local only)
vaultx file upload --path ./report.pdf --owner alice --password secret

# Upload a file and sync to remote
vaultx file upload --path ./report.pdf --owner alice --password secret --remote --api http://localhost:3001

# Download a file
vaultx file download --fileId file-123 --password secret --dest ./output.pdf

# Grant read permission
vaultx perm grant --fileId file-123 --userId bob --perm read

# Show audit logs
vaultx logs

# Run sync
vaultx sync run --fileId file-123 --dirs ./vault1,./vault2
```
## Core Features

### File Encryption
- AES-256-GCM encryption for file contents
- Unique encryption keys per file
- Secure key derivation using user passwords

### File Management
- Drag-and-drop file upload interface
- Encrypted file storage in local vault
- File metadata management
- Version control and conflict resolution

### Synchronization
- Automatic synchronization between devices
- Conflict resolution based on timestamps
- Offline-first architecture with sync on connection
- Incremental sync to minimize bandwidth usage

### User Management
- Secure user registration and authentication
- Role-based access control
- Session management with JWT tokens
- Audit logging for security compliance

## API Endpoints

The server provides the following REST API endpoints:

### Authentication
- `POST /register` - User registration
- `POST /login` - User authentication
- `GET /health` - Health check

### File Management
- `POST /files/upload-url` - Get signed upload URL
- `POST /files/metadata` - Persist file metadata
- `GET /files` - List user files
- `POST /files/download-url` - Get signed download URL

## Database Schema

### Users Table
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
    createdAt TIMESTAMPTZ DEFAULT now()
);
```

### Files Table
```sql
CREATE TABLE files (
    id TEXT PRIMARY KEY,
    originalName TEXT NOT NULL,
    encryptedName TEXT NOT NULL,
    createdAt TIMESTAMPTZ NOT NULL,
    lastModifiedUTC TIMESTAMPTZ NOT NULL,
    version INT NOT NULL DEFAULT 1,
    ownerId UUID NOT NULL REFERENCES users(id),
    storagePath TEXT NOT NULL
);
```

### Audit Log Table
```sql
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL,
    userId UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details TEXT
);
```

## Deployment Considerations

### Current Development Setup
The application currently requires manual setup of AWS S3-compatible storage (Supabase) for development and testing purposes. This is a temporary requirement for the development phase.

### Future Production Deployment
The server component will be deployed to a cloud platform with the following considerations:
- Environment variable configuration for production
- SSL/TLS termination
- Database connection pooling
- File storage service integration
- Monitoring and logging setup

### Security Considerations
- All API endpoints require authentication
- File uploads use signed URLs with expiration
- User data is isolated by user ID in storage paths
- Local file encryption prevents server-side data access
- Audit logging for compliance and security monitoring

## Development Guidelines

### Code Style
- Use consistent indentation (2 spaces)
- Follow JavaScript ES6+ standards
- Implement comprehensive error handling
- Include JSDoc comments for public APIs

### Testing Requirements
- Maintain test coverage above 80%
- Include both unit and integration tests
- Test error conditions and edge cases
- Mock external dependencies appropriately

### Security Best Practices
- Never log sensitive data
- Validate all user inputs
- Use parameterized queries for database operations
- Implement proper error handling without information leakage

## Troubleshooting

### Common Issues

1. **Native Module Build Errors**
   - Ensure Node.js version compatibility
   - Clear node_modules and reinstall dependencies
   - Check for conflicting native modules

2. **Database Connection Issues**
   - Verify DATABASE_URL format
   - Check network connectivity to NeonDB
   - Ensure SSL configuration is correct

3. **File Upload Failures**
   - Verify AWS S3 credentials
   - Check bucket permissions
   - Ensure signed URL generation is working

4. **Synchronization Issues**
   - Check network connectivity
   - Verify JWT token validity
   - Review server logs for API errors

## Contributing

1. Fork the repository
2. Create a feature branch
3. Implement changes with tests
4. Ensure all tests pass
5. Submit a pull request

## License

This project is licensed under the MIT License. See the LICENSE file for details.

## Support

For technical support or questions:
- Create an issue in the repository
- Contact:

## Version History

- v1.0.0 - Initial release with core encryption and synchronization features

