#!/bin/sh
# Start the Db2 JDBC bridge on 127.0.0.1:8099.
#
# Used by the launchd agent in install-service.sh, and safe to run by hand.
# Resolves the JDK and driver jar relative to this script so it keeps working
# if the project is moved.

set -e

BRIDGE_DIR=$(cd "$(dirname "$0")" && pwd)
PROJECT_DIR=$(cd "$BRIDGE_DIR/../.." && pwd)
JAR_DIR="$PROJECT_DIR/db2/db2jdbc"

# Prefer an explicitly configured JDK, then the one shipped with the tooling,
# then whatever is on PATH.
if [ -n "$JAVA_HOME" ] && [ -x "$JAVA_HOME/bin/java" ]; then
  JAVA="$JAVA_HOME/bin/java"
elif [ -x "$HOME/.workbuddy-ai/binaries/java/jdk-17.0.20.1+1/Contents/Home/bin/java" ]; then
  JAVA="$HOME/.workbuddy-ai/binaries/java/jdk-17.0.20.1+1/Contents/Home/bin/java"
else
  JAVA=java
fi

if [ ! -f "$JAR_DIR/db2jcc4.jar" ]; then
  echo "Db2 JDBC driver not found at $JAR_DIR/db2jcc4.jar" >&2
  exit 1
fi

cd "$BRIDGE_DIR"
exec "$JAVA" -cp ".:$JAR_DIR/db2jcc4.jar:$JAR_DIR/db2jcc_license_cisuz.jar" Db2Bridge
