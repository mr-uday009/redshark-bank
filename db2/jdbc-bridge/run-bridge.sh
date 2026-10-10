#!/bin/sh
# Start the Db2 for z/OS JDBC bridge.
#
# The website is Node, but the only Db2 client that can reach z/OS without a
# paid Db2 Connect licence is the JDBC driver. This runs the bridge that owns
# the JDBC connection and exposes the four operations the site needs.
#
# Usage:  ./run-bridge.sh
# Then start the website normally (npm run dev).

set -e

HERE=$(cd "$(dirname "$0")" && pwd)
JARS="$HERE/../db2jdbc"

# Find a JDK 17+ in this order:
#   1. JAVA_HOME, if you have set one
#   2. the JDK bundled with the local tooling, if present
#   3. whatever `java` is on PATH
# Override JAVA_HOME if none of these is right.
if [ -z "$JAVA_HOME" ]; then
  for CANDIDATE in \
    "$HOME/.workbuddy-ai/binaries/java/jdk-17.0.20.1+1/Contents/Home" \
    "$HOME/.workbuddy-ai/binaries/java"/*/Contents/Home \
    /Library/Java/JavaVirtualMachines/*/Contents/Home
  do
    if [ -x "$CANDIDATE/bin/java" ]; then
      JAVA_HOME="$CANDIDATE"
      break
    fi
  done
fi

if [ -n "$JAVA_HOME" ] && [ -x "$JAVA_HOME/bin/java" ]; then
  JAVA="$JAVA_HOME/bin/java"
  JAVAC="$JAVA_HOME/bin/javac"
else
  JAVA=java
  JAVAC=javac
fi

if ! command -v "$JAVA" >/dev/null 2>&1; then
  echo "No JDK found. Set JAVA_HOME to a JDK 17+ install, or put java on PATH." >&2
  exit 1
fi

# --- Db2 connection settings (override via environment) ---------------------
BRIDGE_HOST=${BRIDGE_HOST:-127.0.0.1}
BRIDGE_PORT=${BRIDGE_PORT:-8099}
DB2_HOST=${DB2_HOST:-192.168.200.150}
DB2_PORT=${DB2_PORT:-5025}
DB2_LOCATION=${DB2_LOCATION:-DALLAS9}
DB2_USER=${DB2_USER:-IBMUSER}
DB2_PASSWORD=${DB2_PASSWORD:-SYS1}
export BRIDGE_HOST BRIDGE_PORT DB2_HOST DB2_PORT DB2_LOCATION DB2_USER DB2_PASSWORD

# --- compile if needed ------------------------------------------------------
if [ ! -f "$HERE/Db2Bridge.class" ] || [ "$HERE/Db2Bridge.java" -nt "$HERE/Db2Bridge.class" ]; then
  echo "Compiling Db2Bridge..."
  "$JAVAC" -cp "$JARS/db2jcc4.jar" -d "$HERE" "$HERE/Db2Bridge.java"
fi

echo "Starting Db2Bridge on $BRIDGE_HOST:$BRIDGE_PORT -> $DB2_HOST:$DB2_PORT/$DB2_LOCATION"
exec "$JAVA" -cp "$HERE:$JARS/db2jcc4.jar:$JARS/db2jcc_license_cisuz.jar" Db2Bridge
