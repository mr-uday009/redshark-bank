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

# Java 17 (Temurin) installed under the WorkBuddy managed binaries directory.
# Override JAVA_HOME if you have your own JDK.
if [ -z "$JAVA_HOME" ]; then
  JAVA_HOME=/Users/redbob/.workbuddy-ai/binaries/java/jdk-17.0.20.1+1/Contents/Home
fi
JAVA="$JAVA_HOME/bin/java"
JAVAC="$JAVA_HOME/bin/javac"

if [ ! -x "$JAVA" ]; then
  echo "Java not found at $JAVA - set JAVA_HOME to a JDK 17+ install." >&2
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
