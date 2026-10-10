//APFLINK  JOB (ACCT),'APFLINK',CLASS=A,MSGCLASS=X,MSGLEVEL=(1,1)
//*==================================================================*
//* Link HASHUD into USER.LINKLIB, which is BOTH APF-authorized and   *
//* in the LNKLST (see ADCD.Z111S.PARMLIB(PROGDB)).                   *
//*                                                                   *
//* Why: the WLM stored-procedure address space runs APF-authorized.  *
//* DSN910.DB9G.RUNLIB.LOAD is NOT in the APF list on this system, so *
//* a module loaded from it cannot be used by that address space -    *
//* which is exactly what SQLCODE -444 ("USER PROGRAM could not be    *
//* found") reports.  A module in an APF + linklisted library is      *
//* reachable from any address space without touching the STEPLIB.    *
//*                                                                   *
//* AC=1 marks the module itself APF-authorized.                      *
//*==================================================================*
//CLEAN    EXEC PGM=IDCAMS
//SYSPRINT DD SYSOUT=*
//SYSIN    DD *
  DELETE IBMUSER.HDFC.APFCOB PURGE
  DELETE IBMUSER.HDFC.APFLKED PURGE
  DELETE IBMUSER.HDFC.APFDONE PURGE
  SET MAXCC=0
/*
//*
//COBOL    EXEC PGM=IGYCRCTL,REGION=0M,PARM='RENT,APOST,LIST,MAP'
//STEPLIB  DD DSN=IGY420.SIGYCOMP,DISP=SHR
//SYSPRINT DD DSN=IBMUSER.HDFC.APFCOB,DISP=(NEW,CATLG,KEEP),
//         SPACE=(TRK,(5,5)),DCB=(RECFM=FBA,LRECL=133,BLKSIZE=13300)
//SYSIN    DD DSN=IBMUSER.HDFC.ICSF(HASHUD),DISP=SHR
//SYSLIN   DD DSN=&&OBJ,DISP=(MOD,PASS),UNIT=SYSDA,
//         SPACE=(TRK,(5,5)),DCB=(RECFM=FB,LRECL=80,BLKSIZE=3200)
//SYSUT1   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//SYSUT2   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//SYSUT3   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//SYSUT4   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//SYSUT5   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//SYSUT6   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//SYSUT7   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//*
//LKED     EXEC PGM=IEWL,REGION=0M,PARM='LIST,XREF,LET,MAP,RENT,AC=1'
//SYSPRINT DD DSN=IBMUSER.HDFC.APFLKED,DISP=(NEW,CATLG,KEEP),
//         SPACE=(TRK,(5,5)),DCB=(RECFM=FBA,LRECL=121,BLKSIZE=12100)
//SYSLIB   DD DSN=CEE.SCEELKED,DISP=SHR
//         DD DSN=CSF.SCSFMOD0,DISP=SHR
//SYSLIN   DD DSN=&&OBJ,DISP=(OLD,DELETE)
//SYSLMOD  DD DSN=USER.LINKLIB(HASHUD),DISP=MOD
//SYSUT1   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//*
//DONE     EXEC PGM=IEBGENER
//SYSPRINT DD SYSOUT=*
//SYSUT1   DD *
APFLINK DONE
/*
//SYSUT2   DD DSN=IBMUSER.HDFC.APFDONE,DISP=(NEW,CATLG,DELETE),
//         SPACE=(TRK,(1,1)),DCB=(RECFM=FB,LRECL=80,BLKSIZE=3200)
//SYSIN    DD DUMMY
