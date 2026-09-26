#!/bin/sh
# Before Jenkins starts:
# 1. Loopback forwards (local stack only): *.localhost always means loopback (curl/git hard-code it), so to use the
#    same URLs as the host (http://jira.localhost:8080 ...) forward this container's loopback ports to the app
#    containers. SDLC_LOCAL_FORWARDS="<port>:<host>:<port> ..."; empty in real deployments.
# 2. Install the sdlc skills and the sdlc-atl CLI for the jenkins user from the mounted sdlc-work repo and register
#    the Jira/Confluence MCP server with the Copilot CLI, using the same wizard developers run. Never blocks Jenkins.
for f in ${SDLC_LOCAL_FORWARDS:-}; do
  lport=${f%%:*}; target=${f#*:}; thost=${target%%:*}; tport=${target#*:}
  socat TCP4-LISTEN:"$lport",bind=127.0.0.1,fork,reuseaddr TCP:"$thost":"$tport" &
  socat TCP6-LISTEN:"$lport",bind=[::1],fork,reuseaddr TCP:"$thost":"$tport" 2>/dev/null &
done
[ -n "${SDLC_LOCAL_FORWARDS:-}" ] && echo "sdlc: loopback forwards: $SDLC_LOCAL_FORWARDS"

if [ -f /opt/sdlc-work/setup.mjs ]; then
  node /opt/sdlc-work/setup.mjs --yes --agents copilot --skip-credentials --skip-prereqs --no-path \
    > "$JENKINS_HOME/sdlc-setup.log" 2>&1 \
    && echo "sdlc: skills and CLI installed (log: $JENKINS_HOME/sdlc-setup.log)" \
    || echo "sdlc: setup.mjs failed, see $JENKINS_HOME/sdlc-setup.log"
else
  echo "sdlc: /opt/sdlc-work not mounted; skipping skill install"
fi
exec /usr/local/bin/jenkins.sh "$@"
