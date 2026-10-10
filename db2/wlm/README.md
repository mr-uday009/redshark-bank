# WLM application environment for BANKAPP.HASHUD

Db2 for z/OS runs an external stored procedure inside a **WLM application
environment**. Three things must line up before `CALL BANKAPP.HASHUD(...)`
will work:

| # | Requirement | Where it is satisfied |
| - | ----------- | --------------------- |
| 1 | An application environment of subsystem type **DB2** exists in the **active** WLM service definition | WLM policy |
| 2 | The JCL procedure that the environment names is findable in the **JES2 procedure-library concatenation** | `PROC00` DD in the JES2 started-task JCL |
| 3 | The load module `HASHUD` is in that procedure's **STEPLIB** | `jcl/BUILD-HASHUD.jcl` |

## What this ADCD system already has

`DSN910.PROCLIB` ships the Db2 WLM procedures:

```
DB9GWLM1  PROC DB2SSN=DB9G,NUMTCB=1,APPLENV=DB9GENV1
          DSNTPSMP EXEC PGM=DSNX9WLM,PARM='&DB2SSN,&NUMTCB,&APPLENV'
          STEPLIB  DSN910.DB9G.RUNLIB.LOAD
                   DSN910.DB9G.SDSNEXIT
                   DSN910.SDSNLOAD
                   CBC.SCCNCMP
                   CEE.SCEERUN
```

and the WLM service definition (`ADCD.Z111S.WLM(AETAB)`) defines the matching
application environments:

```
DB9GENV1  DB2  DB9GWLM1      DB9GENV2  DB2  DB9GWLM2
DB9GENV3  DB2  DB9GWLM3      DB9GENV4  DB2  DB9GWLM4
DB9GENV5  DB2  DB9GWLM5      DB9GENV6  DB2  DB9GWLM6
DB9GENV7  DB2  DB9GWLM7      DB9GENVA  DB2  DB9GWLMA
DB9GENVC  DB2  DB9GWLMC      DB9GENVJ  DB2  DB9GWLMJ
DB9GENVQ  DB2  DB9GWLMQ      DB9GENVW  DB2  DB9GWLMW
DB9GRFSH  DB2  DB9GRFSH
```

So **you do not have to invent `WLMENV1`** — use `DB9GENV1`.

## The gap, and how to close it

`DSN910.PROCLIB` is **not** in the JES2 `PROC00` concatenation. The JES2
started-task JCL (`ADCD.Z111S.PROCLIB(JES2)`) concatenates:

```
//PROC00  DD DSN=USER.PROCLIB,DISP=SHR
//        DD DSN=ADCD.Z111S.PROCLIB,DISP=SHR
//        DD DSN=EUV.SEUVPRC,DISP=SHR
//        DD DSN=IOE.SIOEPROC,DISP=SHR
//        DD DSN=EOY.SEOYPROC,DISP=SHR
//        DD DSN=HLA.SASMSAM1,DISP=SHR
//        DD DSN=SYS1.PROCLIB,DISP=SHR
```

Because `DB9GWLM1` cannot be found, WLM cannot start the address space and
Db2 returns **SQLCODE -471 / SQLSTATE 55023** for every call.

Fix: copy the procedure into `USER.PROCLIB` (already done on this system, the
copy is kept in `wlm/DB9GWLM1.proc`):

```
ftp> quote site filetype=seq
ftp> quote site lrecl=80
ftp> quote site recfm=fb
ftp> put DB9GWLM1.proc 'USER.PROCLIB(DB9GWLM1)'
```

The permanent fix is to add `DSN910.PROCLIB` to the `PROC00` DD concatenation
and restart JES2.

## Defining your own environment (`WLMENV1`)

If you want a dedicated environment called `WLMENV1`:

1. **WLM policy** — ISPF → `WLM` → option `6` (Application Environments) →
   `4` (Define) → create an environment with
   * subsystem type **DB2**
   * JCL procedure name `WLMENV1`
   * start parameters `DB2SSN IWMSSNM APPLENV` (substitution symbols supplied
     by WLM)
   then install the service definition.
2. **Procedure** — put `WLMENV1` in a library that is in the JES2 `PROC00`
   concatenation, modelled on `wlm/DB9GWLM1.proc`:

```
//WLMENV1  PROC DB2SSN=DB9G,NUMTCB=1,APPLENV=WLMENV1
//DSNTPSMP EXEC PGM=DSNX9WLM,TIME=1440,
//             PARM='&DB2SSN,&NUMTCB,&APPLENV',
//             REGION=0M,DYNAMNBR=5
//STEPLIB  DD DISP=SHR,DSN=IBMUSER.HDFC.LOAD        <== your load library
//         DD DISP=SHR,DSN=DSN910.DB9G.SDSNEXIT
//         DD DISP=SHR,DSN=DSN910.SDSNLOAD
//         DD DISP=SHR,DSN=CBC.SCCNCMP
//         DD DISP=SHR,DSN=CEE.SCEERUN
//         DD DISP=SHR,DSN=CSF.SCSFMOD0             <== ICSF, if not LNKLSTed
//SYSTSPRT DD SYSOUT=*
//CEEDUMP  DD SYSOUT=*
//SYSIN    DD UNIT=3390,SPACE=(4000,(20,20),,,ROUND)
//SYSPRINT DD UNIT=3390,SPACE=(4000,(20,20),,,ROUND)
//SYSABEND DD DUMMY
//DSNTRACE DD SYSOUT=*
```

3. **RACF** — the WLM environment runs under a userid that needs READ access
   to the load library and to `CSF.SCSFMOD0`, plus EXECUTE on
   `BANKAPP.HASHUD`. Db2 also needs to be authorised to the environment.

4. **Reference it** in `sql/02-create-procedure.sql`:
   `WLM ENVIRONMENT WLMENV1`.

## ICSF / CSF.SCSFMOD0

`CSNBOWH` lives in `CSF.SCSFMOD0`. On this system that library is in the
`LNKLST` (`ADCD.Z111S.PARMLIB(PROG00)`), so it resolves for any address space
and no STEPLIB entry is required. If your system does not linklist it, add it
to the STEPLIB as shown above.
