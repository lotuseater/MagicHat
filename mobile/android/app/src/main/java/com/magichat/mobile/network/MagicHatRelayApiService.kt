package com.magichat.mobile.network

import com.magichat.mobile.model.CliInstanceWire
import com.magichat.mobile.model.CliInstancesResponse
import com.magichat.mobile.model.CliLaunchRequest
import com.magichat.mobile.model.CliPresetsResponse
import com.magichat.mobile.model.CliPromptRequest
import com.magichat.mobile.model.BrowserActionRequest
import com.magichat.mobile.model.BrowserPagesResponse
import com.magichat.mobile.model.FollowUpRequest
import com.magichat.mobile.model.InstanceWire
import com.magichat.mobile.model.InstancesResponse
import com.magichat.mobile.model.LaunchInstanceRequest
import com.magichat.mobile.model.RemoteClaimStatusResponse
import com.magichat.mobile.model.RemoteDeviceRegisterRequest
import com.magichat.mobile.model.RemoteDeviceRegisterResponse
import com.magichat.mobile.model.RemoteHostsResponse
import com.magichat.mobile.model.RemotePairClaimRequest
import com.magichat.mobile.model.RemotePairClaimResponse
import com.magichat.mobile.model.RemoteSessionRefreshRequest
import com.magichat.mobile.model.RemoteSessionRefreshResponse
import com.magichat.mobile.model.RestoreRefsResponse
import com.magichat.mobile.model.SubmissionReceipt
import com.magichat.mobile.model.TrustRequest
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface MagicHatRelayApiService {
    @POST("v2/mobile/pair/bootstrap/claim")
    suspend fun claimBootstrap(
        @Body request: RemotePairClaimRequest,
    ): RemotePairClaimResponse

    @GET("v2/mobile/pair/bootstrap/claims/{claimId}")
    suspend fun getClaimStatus(
        @Path("claimId") claimId: String,
    ): RemoteClaimStatusResponse

    @POST("v2/mobile/pair/device/register")
    suspend fun completeRegistration(
        @Body request: RemoteDeviceRegisterRequest,
    ): RemoteDeviceRegisterResponse

    @POST("v2/mobile/session/refresh")
    suspend fun refreshSession(
        @Body request: RemoteSessionRefreshRequest,
    ): RemoteSessionRefreshResponse

    @GET("v2/mobile/hosts")
    suspend fun listHosts(): RemoteHostsResponse

    @GET("v2/mobile/hosts/{hostId}/instances")
    suspend fun listInstances(
        @Path("hostId") hostId: String,
    ): InstancesResponse

    @POST("v2/mobile/hosts/{hostId}/instances")
    suspend fun launchInstance(
        @Path("hostId") hostId: String,
        @Body request: LaunchInstanceRequest,
    ): InstanceWire

    @GET("v2/mobile/hosts/{hostId}/instances/{instanceId}")
    suspend fun getInstanceDetail(
        @Path("hostId") hostId: String,
        @Path("instanceId") instanceId: String,
    ): InstanceWire

    @DELETE("v2/mobile/hosts/{hostId}/instances/{instanceId}")
    suspend fun closeInstance(
        @Path("hostId") hostId: String,
        @Path("instanceId") instanceId: String,
    ): SubmissionReceipt

    @POST("v2/mobile/hosts/{hostId}/instances/{instanceId}/prompt")
    suspend fun sendPrompt(
        @Path("hostId") hostId: String,
        @Path("instanceId") instanceId: String,
        @Body request: com.magichat.mobile.model.PromptRequest,
    ): SubmissionReceipt

    @POST("v2/mobile/hosts/{hostId}/instances/{instanceId}/follow-up")
    suspend fun sendFollowUp(
        @Path("hostId") hostId: String,
        @Path("instanceId") instanceId: String,
        @Body request: FollowUpRequest,
    ): SubmissionReceipt

    @POST("v2/mobile/hosts/{hostId}/instances/{instanceId}/trust")
    suspend fun answerTrustPrompt(
        @Path("hostId") hostId: String,
        @Path("instanceId") instanceId: String,
        @Body request: TrustRequest,
    ): SubmissionReceipt

    @POST("v2/mobile/hosts/{hostId}/instances/{instanceId}/restore")
    suspend fun restoreIntoExistingInstance(
        @Path("hostId") hostId: String,
        @Path("instanceId") instanceId: String,
        @Body request: LaunchInstanceRequest,
    ): SubmissionReceipt

    @GET("v2/mobile/hosts/{hostId}/restore-refs")
    suspend fun listRestoreRefs(
        @Path("hostId") hostId: String,
    ): RestoreRefsResponse

    @GET("v2/mobile/hosts/{hostId}/cli-instances/presets")
    suspend fun listCliPresets(
        @Path("hostId") hostId: String,
    ): CliPresetsResponse

    @GET("v2/mobile/hosts/{hostId}/cli-instances")
    suspend fun listCliInstances(
        @Path("hostId") hostId: String,
    ): CliInstancesResponse

    @GET("v2/mobile/hosts/{hostId}/cli-instances/{instanceId}")
    suspend fun getCliInstance(
        @Path("hostId") hostId: String,
        @Path("instanceId") instanceId: String,
    ): CliInstanceWire

    @POST("v2/mobile/hosts/{hostId}/cli-instances")
    suspend fun launchCliInstance(
        @Path("hostId") hostId: String,
        @Body request: CliLaunchRequest,
    ): CliInstanceWire

    @DELETE("v2/mobile/hosts/{hostId}/cli-instances/{instanceId}")
    suspend fun closeCliInstance(
        @Path("hostId") hostId: String,
        @Path("instanceId") instanceId: String,
    ): SubmissionReceipt

    @POST("v2/mobile/hosts/{hostId}/cli-instances/{instanceId}/prompt")
    suspend fun sendCliPrompt(
        @Path("hostId") hostId: String,
        @Path("instanceId") instanceId: String,
        @Body request: CliPromptRequest,
    ): SubmissionReceipt

    @GET("v2/mobile/hosts/{hostId}/browser/pages")
    suspend fun listBrowserPages(
        @Path("hostId") hostId: String,
    ): BrowserPagesResponse

    @POST("v2/mobile/hosts/{hostId}/browser/actions")
    suspend fun runBrowserAction(
        @Path("hostId") hostId: String,
        @Body request: BrowserActionRequest,
    ): SubmissionReceipt
}
