package com.magichat.mobile.network

import com.magichat.mobile.model.FollowUpRequest
import com.magichat.mobile.model.HealthzResponse
import com.magichat.mobile.model.HostInfoResponse
import com.magichat.mobile.model.InstanceWire
import com.magichat.mobile.model.InstancesResponse
import com.magichat.mobile.model.LaunchInstanceRequest
import com.magichat.mobile.model.PairRequest
import com.magichat.mobile.model.PairResponse
import com.magichat.mobile.model.PromptRequest
import com.magichat.mobile.model.SubmissionReceipt
import com.magichat.mobile.model.TrustRequest
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface MagicHatApiService {
    @GET("healthz")
    suspend fun getHealth(): HealthzResponse

    @POST("v1/pairing/session")
    suspend fun pairHost(
        @Body request: PairRequest,
    ): PairResponse

    @GET("v1/host")
    suspend fun getHostInfo(): HostInfoResponse

    @GET("v1/instances")
    suspend fun listInstances(): InstancesResponse

    @GET("v1/instances/{instanceId}")
    suspend fun getInstanceDetail(
        @Path("instanceId") instanceId: String,
    ): InstanceWire

    @POST("v1/instances")
    suspend fun launchInstance(
        @Body request: LaunchInstanceRequest,
    ): InstanceWire

    @DELETE("v1/instances/{instanceId}")
    suspend fun closeInstance(
        @Path("instanceId") instanceId: String,
    )

    @POST("v1/instances/{instanceId}/prompt")
    suspend fun sendPrompt(
        @Path("instanceId") instanceId: String,
        @Body request: PromptRequest,
    ): SubmissionReceipt

    @POST("v1/instances/{instanceId}/follow-up")
    suspend fun sendFollowUp(
        @Path("instanceId") instanceId: String,
        @Body request: FollowUpRequest,
    ): SubmissionReceipt

    @POST("v1/instances/{instanceId}/trust")
    suspend fun answerTrustPrompt(
        @Path("instanceId") instanceId: String,
        @Body request: TrustRequest,
    ): SubmissionReceipt
}
