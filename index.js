const core = require('@actions/core');
const exec = require('@actions/exec');
const aws = require('aws-sdk');

async function run() {
  const registryUriState = [];
  const skipLogout = core.getInput('skip-logout', { required: false });
  let ecrType = core.getInput('ecr-type', { required: false });

  if (ecrType != 'public') {
    ecrType = 'private';
  }
  try {
    const registries = core.getInput('registries', { required: false });

    // Get the ECR authorization token
    const ecr = new aws.ECR({
      customUserAgent: 'amazon-ecr-login-for-github-actions'
    });
    const ecrpublic = new aws.ECRPUBLIC({
      customUserAgent: 'amazon-ecr-login-for-github-actions',
      region: 'us-east-1'
    });
    const authTokenRequest = {};
    if (registries && isecrprivate) {
      const registryIds = registries.split(',');
      core.debug(`Requesting auth token for ${registryIds.length} registries:`);
      for (const id of registryIds) {
        core.debug(`  '${id}'`);
      }
      authTokenRequest.registryIds = registryIds;
    }

    let authTokenResponse;

    switch (ecrType) {
      case 'public': {
        authTokenResponse = await ecrpublic.getAuthorizationToken({}).promise();
        authTokenResponse.authorizationData = [ authTokenResponse.authorizationData ];
        break;
      }
      default: {
        authTokenResponse = await ecr.getAuthorizationToken(authTokenRequest).promise();
        break;
      }
    }

    if (!Array.isArray(authTokenResponse.authorizationData) || !authTokenResponse.authorizationData.length) {
      throw new Error('Could not retrieve an authorization token from Amazon ECR');
    }

    for (const authData of authTokenResponse.authorizationData) {
      const authToken = Buffer.from(authData.authorizationToken, 'base64').toString('utf-8');
      const creds = authToken.split(':', 2);
      let registryUri, proxyEndpoint;
      if (ecrType == 'private') {
        proxyEndpoint = authData.proxyEndpoint;
        registryUri = proxyEndpoint.replace(/^https?:\/\//,''); 
      } else {
        registryUri = 'public.ecr.aws';
        proxyEndpoint = registryUri;
      }

      if (authTokenResponse.authorizationData.length == 1) {
        // output the registry URI if this action is doing a single registry login
        core.setOutput('registry', registryUri);
      }

      // Execute the docker login command
      let doLoginStdout = '';
      let doLoginStderr = '';
      const exitCode = await exec.exec('docker login', ['-u', creds[0], '-p', creds[1], proxyEndpoint], {
        silent: true,
        ignoreReturnCode: true,
        listeners: {
          stdout: (data) => {
            doLoginStdout += data.toString();
          },
          stderr: (data) => {
            doLoginStderr += data.toString();
          }
        }
      });

      if (exitCode != 0) {
        core.debug(doLoginStdout);
        throw new Error('Could not login: ' + doLoginStderr);
      }
      core.debug(`login stdout=${doLoginStdout}`);
      core.debug(`login stderr=${doLoginStderr}`);

      registryUriState.push(registryUri);
    }
  }
  catch (error) {
    core.setFailed(error.message);
  }

  // Pass the logged-in registry URIs to the post action for logout
  if (registryUriState.length) {
    if (!skipLogout) {
        core.saveState('registries', registryUriState.join());
    }
    core.debug(`'skip-logout' is ${skipLogout} for ${registryUriState.length} registries.`);
  }
}

module.exports = run;

/* istanbul ignore next */
if (require.main === module) {
    run();
}
