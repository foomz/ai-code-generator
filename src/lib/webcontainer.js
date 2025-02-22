import { WebContainer } from '@webcontainer/api';

let webcontainerInstance = null;

export async function getWebContainerInstance() {
  if (!webcontainerInstance) {
    webcontainerInstance = await WebContainer.boot();
  }
  return webcontainerInstance;
}

export async function mountAndStartProject(files) {
  const webcontainer = await getWebContainerInstance();
  
  // Ensure we have the basic required files
  const requiredFiles = {
    'package.json': {
      file: {
        contents: JSON.stringify({
          name: 'generated-app',
          private: true,
          type: 'module',
          scripts: {
            dev: 'vite --host',
            build: 'vite build',
            preview: 'vite preview'
          },
          dependencies: {
            'react': '^18.2.0',
            'react-dom': '^18.2.0',
            '@vitejs/plugin-react': '^4.2.1',
            'vite': '^5.0.8'
          }
        }, null, 2)
      }
    },
    'vite.config.js': {
      file: {
        contents: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    hmr: true,
    port: 5173,
    host: true
  }
});`
      }
    },
    'index.html': {
      file: {
        contents: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Generated App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`
      }
    }
  };

  try {
    // Create a clean file structure
    const processedFiles = {};
    
    // Process the provided files
    for (const [path, content] of Object.entries(files)) {
      if (!content) continue;
      
      // Ensure the file has the correct structure
      processedFiles[path] = {
        file: {
          contents: typeof content === 'string' ? content : 
                   content.file ? content.file.contents : 
                   JSON.stringify(content, null, 2)
        }
      };
    }

    // Merge with required files, giving precedence to processed files
    const mergedFiles = { ...requiredFiles, ...processedFiles };

    // Create directory structure
    const directories = new Set();
    Object.keys(mergedFiles).forEach(path => {
      const parts = path.split('/');
      if (parts.length > 1) {
        let currentPath = '';
        parts.slice(0, -1).forEach(part => {
          currentPath += (currentPath ? '/' : '') + part;
          directories.add(currentPath);
        });
      }
    });

    // Sort directories by depth
    const sortedDirs = Array.from(directories)
      .sort((a, b) => (a.match(/\//g) || []).length - (b.match(/\//g) || []).length);

    // Create the file system structure
    const fileSystem = {
      ...Object.fromEntries(sortedDirs.map(dir => [dir, { directory: {} }])),
      ...mergedFiles
    };

    // Mount the file system
    await webcontainer.mount(fileSystem);

    // Install dependencies
    const installProcess = await webcontainer.spawn('npm', ['install']);
    
    const installExitCode = await installProcess.exit;
    
    if (installExitCode !== 0) {
      throw new Error('Failed to install dependencies');
    }

    // Start the dev server
    const devProcess = await webcontainer.spawn('npm', ['run', 'dev']);

    // Wait for the server to be ready
    const serverUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server startup timeout'));
      }, 10000);

      let buffer = '';
      devProcess.output.pipeTo(
        new WritableStream({
          write(data) {
            buffer += data;
            if (buffer.includes('Network:')) {
              const match = buffer.match(/Network:\s+(http:\/\/[\d.:]+)/);
              if (match?.[1]) {
                clearTimeout(timeout);
                resolve(match[1]);
              }
            }
          }
        })
      ).catch(error => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    return {
      webcontainer,
      devProcess,
      serverUrl
    };
  } catch (error) {
    if (webcontainer) {
      try {
        await webcontainer.teardown();
        webcontainerInstance = null;
      } catch (teardownError) {
        console.error('Error during teardown:', teardownError);
      }
    }
    throw error;
  }
}