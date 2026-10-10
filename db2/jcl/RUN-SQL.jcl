//BANKDB   JOB (ACCT),'BANK DDL',CLASS=A,MSGCLASS=X,MSGLEVEL=(1,1)
//*==================================================================*
//* Run a SQL script against Db2 for z/OS using DSNTEP2.              *
//* Replace the SYSIN member with the script you want to run:         *
//*   01-create-objects.sql   02-create-procedure.sql                 *
//*   03-migrate-users.sql    04-verify.sql                           *
//*                                                                   *
//* Upload the .sql member first, e.g. from z/OS UNIX:                *
//*   cp /tmp/01-create-objects.sql "//'IBMUSER.BANKAPP.SQL(DDL)'"    *
//*==================================================================*
//RUNSQL   EXEC PGM=IKJEFT01,DYNAMNBR=50
//STEPLIB  DD DSN=DSN910.SDSNLOAD,DISP=SHR
//SYSTSPRT DD SYSOUT=*
//SYSPRINT DD SYSOUT=*
//SYSUDUMP DD SYSOUT=*
//SYSTSIN  DD *
  DSN SYSTEM(DB9G)
  RUN PROGRAM(DSNTEP2) PLAN(DSNTEP91) -
      LIB('DSN910.DB9G.RUNLIB.LOAD')
  END
/*
//SYSIN    DD DSN=IBMUSER.BANKAPP.SQL(DDL),DISP=SHR
