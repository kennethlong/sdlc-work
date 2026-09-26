# Local Jenkins for the headless "work this ticket" loop (W-4). Dev only.
# Adds what `sdlc-atl work` needs to run an AI agent: Node 24, git, uv/uvx (the Jira/Confluence MCP server) and the
# GitHub Copilot CLI. Configured as code (casc/), no setup wizard. Credentials come from the environment at run time,
# never from the image.
FROM jenkins/jenkins:lts-jdk21

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git gnupg socat \
 && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && npm install -g @github/copilot \
 && curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt

COPY sdlc-entrypoint.sh /usr/local/bin/sdlc-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/sdlc-entrypoint.sh && chmod 755 /usr/local/bin/sdlc-entrypoint.sh

USER jenkins
ENV JAVA_OPTS="-Djenkins.install.runSetupWizard=false" \
    CASC_JENKINS_CONFIG=/casc
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/sdlc-entrypoint.sh"]
